import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

function readWorkerSource(): string {
    return readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
}

function readHandler(source: string, eventName: string, nextEventName: string): string {
    const start = source.indexOf(`self.addEventListener('${eventName}'`);
    const end = source.indexOf(`self.addEventListener('${nextEventName}'`, start);
    if (start < 0 || end < 0) {
        throw new Error(`Could not locate ${eventName} handler`);
    }
    return source.slice(start, end);
}

it("worker never caches business data", () => {
    const source = readWorkerSource();

    expect(source).not.toContain('addEventListener("fetch"');
    expect(source).not.toContain("addEventListener('fetch'");
    expect(source).not.toContain("caches.");
});

it("invalid push payload still displays generic notification", () => {
    const pushHandler = readHandler(readWorkerSource(), "push", "notificationclick");

    expect(pushHandler).toContain("tag: notificationId || 'departmenthub-update'");
    expect(pushHandler).toContain("/^[A-Za-z0-9_-]{1,128}$/");
});

it("click opens only fixed same origin inbox", () => {
    const notificationClickHandler = readHandler(readWorkerSource(), "notificationclick", "message");

    expect(notificationClickHandler).toContain(
        "self.clients.openWindow(new URL('/inbox', self.location.origin).href)",
    );
    expect(notificationClickHandler.match(/new URL\(/g)).toHaveLength(1);
    expect(notificationClickHandler).not.toMatch(/new URL\([^)]*event\./);
});
