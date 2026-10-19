import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth, signIn } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { z } from "zod";

const passwordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Z]/, "Password must contain an uppercase letter")
        .regex(/[a-z]/, "Password must contain a lowercase letter")
        .regex(/[0-9!@#$%^&*]/, "Password must contain a number or special character"),
});

export async function PUT(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { currentPassword, newPassword } = passwordSchema.parse(body);

        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { email: true, password: true },
        });

        if (!user?.password) {
            return NextResponse.json(
                { error: "No password set. Use forgot password to create one." },
                { status: 400 }
            );
        }

        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
            return NextResponse.json(
                { error: "Current password is incorrect" },
                { status: 400 }
            );
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const [updatedUser] = await prisma.$transaction([
            prisma.user.update({
                where: { id: session.user.id },
                data: {
                    password: hashedPassword,
                    passwordVersion: { increment: 1 },
                },
                select: { email: true },
            }),
            // JWT sessions are stateless, but clear any adapter sessions that
            // may exist so the invalidation also covers a future strategy.
            prisma.session.deleteMany({ where: { userId: session.user.id } }),
        ]);

        // Re-authenticate with the new password so this browser receives a
        // freshly signed JWT carrying the incremented passwordVersion. Other
        // JWTs retain the old version and are rejected by the jwt callback.
        await signIn("credentials", {
            email: updatedUser.email,
            password: newPassword,
            redirect: false,
        });

        return NextResponse.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
        }
        console.error("PUT /api/users/me/password error:", error);
        return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
    }
}
