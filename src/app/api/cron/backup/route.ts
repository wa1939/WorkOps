import { NextResponse } from "next/server";

const NEON_API_BASE = "https://console.neon.tech/api/v2";
const PROJECT_ID = process.env.NEON_PROJECT_ID;
const API_KEY = process.env.NEON_API_KEY;
const PARENT_BRANCH = process.env.NEON_BRANCH_ID || "main";
const MAX_BACKUPS = 7; // Keep last 7 daily backups

async function neonFetch(path: string, options: RequestInit = {}) {
    const res = await fetch(`${NEON_API_BASE}${path}`, {
        ...options,
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
            ...options.headers,
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Neon API ${res.status}: ${text}`);
    }
    return res.json();
}

async function handleBackup(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!PROJECT_ID || !API_KEY) {
            return NextResponse.json(
                { error: "NEON_PROJECT_ID and NEON_API_KEY must be configured" },
                { status: 500 }
            );
        }

        const now = new Date();
        const label = now.toISOString().slice(0, 10); // e.g. 2026-04-19
        const branchName = `backup-${label}`;

        // List existing branches to check for duplicates and clean old backups
        const { branches } = await neonFetch(`/projects/${PROJECT_ID}/branches`);

        const backupBranches = (branches as Array<{ id: string; name: string; created_at: string }>)
            .filter((b) => b.name.startsWith("backup-"))
            .sort((a, b) => b.created_at.localeCompare(a.created_at));

        // Skip if today's backup already exists
        const alreadyExists = backupBranches.some((b) => b.name === branchName);
        if (alreadyExists) {
            return NextResponse.json({
                success: true,
                message: `Backup ${branchName} already exists`,
                skipped: true,
            });
        }

        // Create new backup branch (point-in-time snapshot)
        const { branch } = await neonFetch(`/projects/${PROJECT_ID}/branches`, {
            method: "POST",
            body: JSON.stringify({
                branch: {
                    name: branchName,
                    parent_id: PARENT_BRANCH,
                },
                endpoints: [], // No compute needed for backup branches
            }),
        });

        // Delete old backups beyond retention limit
        const deleted: string[] = [];
        if (backupBranches.length >= MAX_BACKUPS) {
            const toDelete = backupBranches.slice(MAX_BACKUPS - 1); // Keep MAX_BACKUPS - 1 + the new one
            for (const old of toDelete) {
                try {
                    await neonFetch(`/projects/${PROJECT_ID}/branches/${old.id}`, {
                        method: "DELETE",
                    });
                    deleted.push(old.name);
                } catch (err) {
                    console.error(`Failed to delete backup branch ${old.name}:`, err);
                }
            }
        }

        return NextResponse.json({
            success: true,
            backup: {
                name: branch.name,
                id: branch.id,
                createdAt: branch.created_at,
            },
            deletedOldBackups: deleted,
            totalBackups: backupBranches.length + 1 - deleted.length,
        });
    } catch (error) {
        console.error("cron/backup error:", error);
        return NextResponse.json(
            { error: "Backup failed", details: String(error) },
            { status: 500 }
        );
    }
}

// Vercel cron sends GET requests
export const GET = handleBackup;
// Keep POST for manual triggers
export const POST = handleBackup;
