import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/lib/email";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";

const signupSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    name: z.string().min(2, "Name must be at least 2 characters"),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { email, password, name } = signupSchema.parse(body);
        const normalizedEmail = email.trim().toLowerCase();

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: "Email already registered" },
                { status: 400 }
            );
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create user
        const user = await prisma.user.create({
            data: {
                email: normalizedEmail,
                name,
                password: hashedPassword,
                role: "MEMBER",
            },
        });

        // Create verification token
        const token = crypto.randomBytes(32).toString("hex");
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await prisma.verificationToken.create({
            data: {
                identifier: normalizedEmail,
                token,
                expires,
            },
        });

        // Send verification email
        await sendVerificationEmail(normalizedEmail, token);

        return NextResponse.json({
            success: true,
            message: "Account created! Please check your email to verify.",
        });
    } catch (error) {
        console.error("Signup error:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.errors[0].message },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Failed to create account" },
            { status: 500 }
        );
    }
}
