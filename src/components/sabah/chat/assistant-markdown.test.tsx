// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import "../test/setup";
import { render, screen, within } from "@testing-library/react";
import { AssistantMarkdown } from "./assistant-markdown";

describe("AssistantMarkdown", () => {
    it("degrades an encoded relative entity link safely without throwing", () => {
        render(<AssistantMarkdown content="[Unverified](%2Ftasks%2Ffake)" />);
        expect(screen.getByText("Unverified")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Unverified" })).not.toBeInTheDocument();
    });
    it("renders GFM tables with semantic headers and numeric cells", () => {
        render(
            <AssistantMarkdown
                content={["| Priority | Count |", "| --- | ---: |", "| High | 2 |"].join("\n")}
            />,
        );

        const table = screen.getByRole("table", { name: "Assistant response table" });
        expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Priority", "Count"]);
        expect(within(table).getByRole("cell", { name: "High" })).toBeInTheDocument();
        expect(within(table).getByRole("cell", { name: "2" })).toBeInTheDocument();
    });

    it("separates a heading marker from preceding provider prose", () => {
        render(<AssistantMarkdown content="Summary text# Heading" />);

        expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
        expect(screen.getByText("Summary text")).toBeInTheDocument();
        expect(screen.queryByText("Summary text# Heading")).not.toBeInTheDocument();
    });

    it("keeps code fences and inline code intact while normalizing headings", () => {
        const content = [
            "Summary text# Heading",
            "",
            "`Summary text# Inline`",
            "",
            "```md",
            "Summary text# Fenced",
            "```",
        ].join("\n");

        const { container } = render(<AssistantMarkdown content={content} />);

        expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
        expect(container.querySelector("code")?.textContent).toContain("Summary text# Inline");
        expect(container.querySelector("pre code")?.textContent).toContain("Summary text# Fenced");
    });

    it("preserves variable-length inline code spans containing hash prose", () => {
        const { container } = render(<AssistantMarkdown content="``code# Heading``" />);

        expect(container.querySelector("code")?.textContent).toBe("code# Heading");
        expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });

    it("preserves a longer fence when its content contains a fence-like run", () => {
        const content = [
            "````md",
            "```",
            "Summary text# Fenced",
            "````",
        ].join("\n");

        const { container } = render(<AssistantMarkdown content={content} />);

        expect(container.querySelector("pre code")?.textContent).toContain("Summary text# Fenced");
        expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });

    it("does not treat C# prose as a heading", () => {
        render(<AssistantMarkdown content="C# code" />);

        expect(screen.getByText("C# code")).toBeInTheDocument();
        expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });

    it("renders verified safe links as navigation but leaves unsafe links as text", () => {
        render(
            <AssistantMarkdown
                content={[
                    "[Task 1](/tasks/t1)",
                    "[JavaScript](javascript:alert(1))",
                    "[Protocol relative](//evil.example)",
                    "[Backslash](/tasks/\\\\evil)",
                    "[Control](/tasks/%07evil)",
                ].join("\n")}
                verifiedHrefs={new Set(["/tasks/t1"])}
            />,
        );

        expect(screen.getByRole("link", { name: "Task 1" })).toHaveAttribute("href", "/tasks/t1");
        for (const name of ["JavaScript", "Protocol relative", "Backslash", "Control"]) {
            expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
            expect(screen.getByText(name)).toBeInTheDocument();
        }
    });

    it("does not present an internal entity link as navigation unless its href is verified", () => {
        // Live-acceptance regression: the provider invented /tasks/cmvan4roo00oyppjc2l4gulcu
        // while the real task id appeared elsewhere as plain text. An unverified
        // internal href must degrade to plain text, never a navigable anchor.
        render(<AssistantMarkdown content="[Task 112](/tasks/cmvan4roo00oyppjc2l4gulcu)" />);

        expect(screen.queryByRole("link", { name: "Task 112" })).not.toBeInTheDocument();
        expect(screen.getByText("Task 112")).toBeInTheDocument();
    });

    it("renders an internal link as navigation only when its exact href is in the verified set", () => {
        render(
            <AssistantMarkdown
                content={["[Verified](/tasks/t-ok)", "[Invented](/tasks/t-invented)"].join("\n")}
                verifiedHrefs={new Set(["/tasks/t-ok"])}
            />,
        );

        expect(screen.getByRole("link", { name: "Verified" })).toHaveAttribute("href", "/tasks/t-ok");
        expect(screen.queryByRole("link", { name: "Invented" })).not.toBeInTheDocument();
        expect(screen.getByText("Invented")).toBeInTheDocument();
    });

    it("keeps external https links navigable without internal verification", () => {
        render(<AssistantMarkdown content="[Docs](https://example.test/docs)" />);

        expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "https://example.test/docs");
    });

    it("does not turn raw HTML into DOM elements", () => {
        const { container } = render(<AssistantMarkdown content={'<script>alert("x")</script>\n\n<strong>raw</strong>'} />);

        expect(container.querySelector("script")).toBeNull();
        expect(container.querySelector("strong")).toBeNull();
    });
});
