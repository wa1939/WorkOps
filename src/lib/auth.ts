import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { isPasswordVersionCurrent } from "@/lib/auth-session";
import { checkRateLimit, LOGIN_RATE_LIMIT } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/rate-limit/request";

export const { handlers, signIn, signOut, auth } = NextAuth({
    adapter: PrismaAdapter(prisma),
    session: {
        strategy: "jwt",
    },
    pages: {
        signIn: "/login",
    },
    providers: [
        // Microsoft Entra ID (Azure AD) for corporate users
        ...(process.env.AZURE_AD_CLIENT_ID
            ? [
                MicrosoftEntraID({
                    clientId: process.env.AZURE_AD_CLIENT_ID!,
                    clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
                    issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
                }),
            ]
            : []),
        // Email/Password login
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                const email = credentials?.email as string;
                const password = credentials?.password as string;

                if (!email || !password) {
                    throw new Error("Email and password are required");
                }

                const normalizedEmail = email.trim().toLowerCase();

                let clientIp: string | null = null;
                try {
                    clientIp = getClientIp(await headers());
                } catch {
                    // authorize() can also run without a request context (for
                    // example in a job or test), so fall back to email-only.
                }
                const loginKey = clientIp
                    ? `login:${normalizedEmail}:${clientIp}`
                    : `login:${normalizedEmail}`;
                const rate = await checkRateLimit(
                    loginKey,
                    LOGIN_RATE_LIMIT.limit,
                    LOGIN_RATE_LIMIT.windowSec,
                );
                if (!rate.allowed) {
                    // Keep this identical for unknown, inactive, and invalid
                    // credentials so the limiter cannot become an oracle.
                    throw new Error("Invalid email or password");
                }

                const user = await prisma.user.findUnique({
                    where: { email: normalizedEmail },
                });

                if (!user) {
                    throw new Error("Invalid email or password");
                }
                if (!user.isActive) {
                    throw new Error("Invalid email or password");
                }

                // Dev mode: allow login without password for testing
                if (process.env.NODE_ENV !== "production" && !user.password) {
                    return {
                        id: user.id,
                        email: user.email,
                        name: user.name,
                        image: user.image,
                    };
                }

                if (!user.password) {
                    throw new Error("Please use Microsoft login or reset your password");
                }

                const isValid = await bcrypt.compare(password, user.password);
                if (!isValid) {
                    throw new Error("Invalid email or password");
                }

                // Check if email is verified (skip in dev mode)
                if (process.env.NODE_ENV === "production" && !user.emailVerified) {
                    throw new Error("Please verify your email before logging in");
                }

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    image: user.image,
                };
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                const normalizedEmail = user.email?.trim().toLowerCase();
                if (!normalizedEmail) {
                    return token;
                }

                const dbUser = await prisma.user.findUnique({
                    where: { email: normalizedEmail },
                    select: { id: true, role: true, passwordVersion: true },
                });
                if (dbUser) {
                    token.id = dbUser.id;
                    token.role = dbUser.role;
                    token.passwordVersion = dbUser.passwordVersion;
                }

                return token;
            }

            // JWT sessions are stateless, so revalidate the version on every
            // refresh. A token from before this claim existed is invalidated.
            if (
                typeof token.id !== "string" ||
                typeof token.passwordVersion !== "number" ||
                !Number.isSafeInteger(token.passwordVersion) ||
                token.passwordVersion < 0
            ) {
                return null;
            }

            const dbUser = await prisma.user.findUnique({
                where: { id: token.id },
                select: { id: true, role: true, isActive: true, passwordVersion: true },
            });
            if (
                !dbUser ||
                dbUser.isActive === false ||
                !isPasswordVersionCurrent(token.passwordVersion, dbUser.passwordVersion)
            ) {
                return null;
            }
            // Re-sync role so demotions/promotions take effect on refresh
            // instead of persisting as stale elevated claims.
            token.role = dbUser.role;

            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id as string;
                session.user.role = token.role as string;
            }
            return session;
        },
    },
});
