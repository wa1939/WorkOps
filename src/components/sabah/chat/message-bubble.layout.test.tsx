import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SabahMessageBubble } from "./message-bubble";

// Exercise real component markup and Tailwind utility CSS in a real, isolated
// browser. jsdom cannot detect min-content overflow/clipped long pasted URLs.
let browser: Browser | undefined;
let css = "";
const evidence = path.resolve(".superpowers/sdd/029-sabah-live-grounding/long-message-evidence");
const cases = [320, 390, 754].flatMap((width) => ["ltr", "rtl"].map((direction) => ({ width, direction })));

beforeAll(async () => {
    const sources = ["./message-bubble.tsx", "./assistant-markdown.tsx", "../sabah-avatar.tsx"]
        .map((file) => ({ raw: readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"), extension: "tsx" }));
    css = (await postcss([tailwindcss({ content: sources })])
        .process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
    // Chrome is also the project's Playwright channel and is present on the
    // GitHub-hosted Ubuntu runner. Never attach to a user's browser profile.
    browser = await chromium.launch({ channel: "chrome", headless: true });
    mkdirSync(evidence, { recursive: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

describe("Sabah pasted-message layout", () => {
    it.each(cases)("contains user URLs, assistant tables and copy controls at $width px in $direction", async ({ width, direction }) => {
        const page = await browser!.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
        try {
            const content = "Presentation-only URL: https://example.test/" + "a".repeat(200);
            const userMarkup = renderToStaticMarkup(<SabahMessageBubble message={{ id: "long-url", role: "user", content }} />);
            const table = "| Field | Value | Notes |\n| --- | --- | --- |\n| Record | " + "b".repeat(200) + " | Complete |";
            const assistantMarkup = renderToStaticMarkup(<SabahMessageBubble message={{ id: "wide-table", role: "assistant", content: table }} />);
            await page.setContent(`<!doctype html><html dir="${direction}"><head><style>${css}
                html,body { margin:0; font-family:Arial,sans-serif; }
                #viewport { width:calc(100vw - 34px); margin:17px; padding:12px; box-sizing:border-box; overflow:auto; }
                </style></head><body><div id="viewport">${userMarkup}${assistantMarkup}</div></body></html>`);
            const bounds = await page.locator("p").evaluate((paragraph) => {
                const container = document.getElementById("viewport")!.getBoundingClientRect();
                const text = paragraph.getBoundingClientRect();
                return { left: text.left, right: text.right, containerLeft: container.left, containerRight: container.right,
                    scrollWidth: paragraph.scrollWidth, clientWidth: paragraph.clientWidth };
            });
            const copy = page.getByRole("button", { name: "Copy message", exact: true });
            await copy.focus();
            const assistant = await page.getByRole("table", { name: "Assistant response table" }).evaluate((table) => {
                const container = document.getElementById("viewport")!;
                const outer = container.getBoundingClientRect();
                const wrapper = table.parentElement!;
                const frame = wrapper.getBoundingClientRect();
                wrapper.scrollLeft = getComputedStyle(wrapper).direction === "rtl" ? -wrapper.scrollWidth : wrapper.scrollWidth;
                const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy message"]')!;
                const button = copy.getBoundingClientRect();
                return { left: frame.left, right: frame.right, outerLeft: outer.left, outerRight: outer.right,
                    scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth, scrollLeft: wrapper.scrollLeft,
                    logScrollWidth: container.scrollWidth, logClientWidth: container.clientWidth,
                    copyLeft: button.left, copyRight: button.right, copyWidth: button.width, copyHeight: button.height,
                    copyFocused: document.activeElement === copy, copyOpacity: getComputedStyle(copy).opacity };
            });
            await page.screenshot({ path: path.join(evidence, `${width}-${direction}.png`) });
            expect(bounds.left).toBeGreaterThanOrEqual(bounds.containerLeft - 1);
            expect(bounds.right).toBeLessThanOrEqual(bounds.containerRight + 1);
            expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
            expect(assistant.left).toBeGreaterThanOrEqual(assistant.outerLeft - 1);
            expect(assistant.right).toBeLessThanOrEqual(assistant.outerRight + 1);
            expect(assistant.scrollWidth).toBeGreaterThan(assistant.clientWidth);
            expect(Math.abs(assistant.scrollLeft)).toBeGreaterThan(0);
            expect(assistant.logScrollWidth).toBeLessThanOrEqual(assistant.logClientWidth + 1);
            expect(assistant.copyLeft).toBeGreaterThanOrEqual(assistant.outerLeft);
            expect(assistant.copyRight).toBeLessThanOrEqual(assistant.outerRight);
            expect(assistant.copyWidth).toBeGreaterThan(0);
            expect(assistant.copyHeight).toBeGreaterThan(0);
            expect(assistant.copyFocused).toBe(true);
            expect(assistant.copyOpacity).toBe("1");
        } finally {
            await page.close();
        }
    }, 15_000);
});
