// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import "../test/setup";
import { render, screen } from "@testing-library/react";
import { ChatThread } from "./chat-thread";

describe("ChatThread verified link plumbing", () => {
    it("forwards the conversation verified-href set so grounded links render as navigation and ungrounded ones stay text", () => {
        render(
            <ChatThread
                messages={[{ id: "a1", role: "assistant", content: "[Real](/tasks/t-ok) versus [Fake](/tasks/t-no)" }]}
                verifiedHrefs={new Set(["/tasks/t-ok"])}
            />,
        );

        expect(screen.getByRole("link", { name: "Real" })).toHaveAttribute("href", "/tasks/t-ok");
        expect(screen.queryByRole("link", { name: "Fake" })).not.toBeInTheDocument();
        expect(screen.getByText("Fake")).toBeInTheDocument();
    });
});
