import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { brand } from "@/lib/brand";

/**
 * Social preview (Open Graph / Twitter) at the 1200x630 platform standard.
 * It reuses the actual user-supplied ribbon mark from public/brand — it does
 * not redraw, recolor, or substitute the monogram (see BRAND.md). The mark
 * keeps its original black background, so it sits on the card as a rounded
 * black tile with a hairline edge.
 */
export const runtime = "nodejs";
export const alt = `${brand.name} — ${brand.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadPrimaryMark(): Promise<string | null> {
    try {
        const file = await readFile(
            path.join(process.cwd(), "public", "brand", "workops-logo.png"),
        );
        return `data:image/png;base64,${file.toString("base64")}`;
    } catch {
        // Mark not present in this checkout: render the text-only card rather
        // than failing the build. BRAND.md still governs; no substitute mark.
        return null;
    }
}

export default async function OpengraphImage() {
    const mark = await loadPrimaryMark();

    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#050912",
                }}
            >
                {mark ? (
                    <div
                        style={{
                            display: "flex",
                            overflow: "hidden",
                            borderRadius: 28,
                            border: "1px solid rgba(255,255,255,0.18)",
                            background: "#000000",
                        }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={mark} width={585} height={289} alt="" />
                    </div>
                ) : null}
                <div
                    style={{
                        display: "flex",
                        fontSize: mark ? 88 : 128,
                        fontWeight: 700,
                        letterSpacing: "-0.03em",
                        color: "#f8fafc",
                        marginTop: mark ? 36 : 0,
                    }}
                >
                    {brand.name}
                </div>
                <div
                    style={{
                        display: "flex",
                        fontSize: 34,
                        color: "#94a3b8",
                        marginTop: 14,
                    }}
                >
                    {brand.tagline}
                </div>
                <div
                    style={{
                        display: "flex",
                        position: "absolute",
                        bottom: 44,
                        fontSize: 24,
                        color: "#64748b",
                    }}
                >
                    Open source · MIT · {brand.repository.owner}/{brand.repository.repo}
                </div>
            </div>
        ),
        { ...size },
    );
}
