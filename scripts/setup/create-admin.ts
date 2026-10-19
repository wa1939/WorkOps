// npm run setup:admin — bootstrap the FIRST admin account on a fresh install.
//
// Safety contract:
//   * Only allowed while the User table is empty; refuses (exit 4) otherwise.
//   * Password comes from a hidden interactive prompt or ADMIN_PASSWORD env —
//     it is never printed, logged, or hardcoded.
//   * Creates the user exactly as production auth requires: bcrypt password,
//     emailVerified set, isActive true, role ADMIN.

import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { AdminRefused, createFirstAdmin } from "./lib/create-admin-core";
import { readDatabaseUrl } from "../assert-local-database";
import { loadSetupEnvironment } from "./lib/environment";

async function promptLine(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await rl.question(question)).trim();
    } finally {
        rl.close();
    }
}

/** Hidden (no-echo) password prompt for TTYs. */
function promptHidden(question: string): Promise<string> {
    return new Promise((resolvePromise, reject) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        if (!stdin.isTTY) {
            reject(new Error("Password prompt requires a terminal. Use ADMIN_PASSWORD env instead."));
            return;
        }
        stdout.write(question);
        let value = "";
        const wasRaw = stdin.isRaw;
        stdin.setRawMode?.(true);
        stdin.resume();
        const onData = (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            for (const char of text) {
                if (char === "\r" || char === "\n") {
                    cleanup();
                    stdout.write("\n");
                    resolvePromise(value);
                    return;
                }
                if (char === "\u0003") {
                    // Ctrl+C
                    cleanup();
                    stdout.write("\n");
                    reject(new Error("Cancelled."));
                    return;
                }
                if (char === "\u007f" || char === "\b") {
                    value = value.slice(0, -1);
                } else {
                    value += char;
                }
            }
        };
        const cleanup = () => {
            stdin.removeListener("data", onData);
            stdin.setRawMode?.(wasRaw);
            stdin.pause();
        };
        stdin.on("data", onData);
    });
}

async function gatherInput(): Promise<{ email: string; name: string; password: string }> {
    const email = process.env.ADMIN_EMAIL ?? "";
    const name = process.env.ADMIN_NAME ?? "";
    const password = process.env.ADMIN_PASSWORD ?? "";

    if (email && password) {
        return { email, name, password };
    }
    if (!process.stdin.isTTY) {
        console.error(
            "[setup:admin] No terminal available for prompts. Set ADMIN_EMAIL, ADMIN_NAME (optional) " +
                "and ADMIN_PASSWORD environment variables instead.",
        );
        process.exit(5);
    }
    console.log("[setup:admin] Bootstrap the first admin. Password input is hidden.");
    const promptedEmail = email || (await promptLine("Admin email: "));
    const promptedName = name || (await promptLine("Admin name (optional, Enter to skip): "));
    const promptedPassword = password || (await promptHidden("Admin password (min 12 chars): "));
    if (!password) {
        const confirm = await promptHidden("Confirm password: ");
        if (confirm !== promptedPassword) {
            console.error("[setup:admin] Passwords do not match. Nothing was written.");
            process.exit(5);
        }
    }
    return { email: promptedEmail, name: promptedName, password: promptedPassword };
}

async function main(): Promise<number> {
    loadSetupEnvironment();
    const input = await gatherInput();
    const databaseUrl = readDatabaseUrl();
    if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
    const client = new PrismaClient({ log: ["error"], datasources: { db: { url: databaseUrl } } });
    try {
        const lines: string[] = [];
        await client.$transaction(async (tx) => createFirstAdmin({
            client: tx,
            input,
            hashPassword: (password) => bcrypt.hash(password, 12),
            log: (line) => lines.push(line),
        }), { isolationLevel: "Serializable" });
        for (const line of lines) console.log(`[setup:admin] ${line}`);
        return 0;
    } finally {
        await client.$disconnect();
    }
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error: unknown) => {
        if (error instanceof AdminRefused) {
            console.error(`[setup:admin] ${error.message}`);
            process.exitCode = error.reason === "users-exist" ? 4 : 5;
            return;
        }
        console.error(`[setup:admin] Failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
