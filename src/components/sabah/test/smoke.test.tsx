// @vitest-environment jsdom
import React from "react";
import { expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

it("runs a jsdom Testing Library test", () => {
    render(<button type="button">Open Sabah</button>);
    expect(screen.getByRole("button", { name: "Open Sabah" })).toBeVisible();
});
