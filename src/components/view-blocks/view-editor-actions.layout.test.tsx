import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, expect as playwrightExpect, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ViewEditorActions } from "./view-editor-actions";

// This regression intentionally uses the project's real-Chrome harness pattern:
// jsdom can assert the responsive classes, but cannot prove that the three
// actions stay inside a 390px viewport.
let browser: Browser | undefined;
let css = "";
const evidence = ".superpowers/sdd/2026-10-16-sabah-custom-view-poc/editor-geometry";
const cases = [390, 768].flatMap((width) => ["ltr", "rtl"].flatMap((direction) =>
    [null, "grad-midnight"].map((cover) => ({ width, direction, cover })),
));

beforeAll(async () => {
    const sources = ["./view-editor-actions.tsx", "./cover-picker.tsx", "../ui/button.tsx"]
        .map((file) => ({ raw: readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"), extension: "tsx" }));
    css = (await postcss([tailwindcss({ content: sources })])
        .process("@tailwind base; @tailwind utilities;", { from: undefined })).css;
    browser = await chromium.launch({ channel: "chrome", headless: true });
    mkdirSync(evidence, { recursive: true });
}, 30_000);

afterAll(async () => {
    await browser?.close();
});

describe("custom view editor action geometry", () => {
    it.each(cases)("keeps actions reachable at $width px in $direction with cover $cover", async ({ width, direction, cover }) => {
        const page = await browser!.newPage({ viewport: { width, height: 640 }, reducedMotion: "reduce" });
        try {
            const markup = renderToStaticMarkup(
                <ViewEditorActions
                    viewId="view-1"
                    cover={cover}
                    saving={false}
                    onCoverChange={() => undefined}
                    onSave={() => undefined}
                />,
            );
            await page.setContent(`<!doctype html><html dir="${direction}"><head><style>${css}
                * { box-sizing: border-box; }
                html, body { margin: 0; font-family: Arial, sans-serif; }
                #frame { width: calc(100vw - 24px); margin: 12px; }
            </style></head><body><main id="frame">${markup}</main></body></html>`);

            const metrics = await page.getByTestId("view-editor-actions").evaluate((element) => {
                const frame = element.getBoundingClientRect();
                const children = Array.from(element.children).map((child) => {
                    const rect = child.getBoundingClientRect();
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
                        scrollWidth: child.scrollWidth, clientWidth: child.clientWidth };
                });
                return {
                    left: frame.left,
                    right: frame.right,
                    clientWidth: element.clientWidth,
                    scrollWidth: element.scrollWidth,
                    children,
                };
            });

            expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
            expect(metrics.children).toHaveLength(3);
            for (const child of metrics.children) {
                expect(child.width).toBeGreaterThan(0);
                expect(child.height).toBeGreaterThan(0);
                expect(child.left).toBeGreaterThanOrEqual(metrics.left - 1);
                expect(child.right).toBeLessThanOrEqual(metrics.right + 1);
                expect(child.scrollWidth).toBeLessThanOrEqual(child.clientWidth + 1);
                if (width < 640) expect(child.height).toBeGreaterThanOrEqual(44);
            }
            await page.screenshot({ path: path.join(evidence, `${width}-${direction}-${cover ? "covered" : "blank"}.png`) });
            await playwrightExpect(page.getByRole("button", { name: cover ? "Change cover" : "Add cover", exact: true })).toBeVisible();
            await playwrightExpect(page.getByRole("link", { name: "Preview", exact: true })).toBeVisible();
            await playwrightExpect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
        } finally {
            await page.close();
        }
    }, 15_000);
});
