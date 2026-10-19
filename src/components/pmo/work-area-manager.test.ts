import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkAreaManager, type WorkAreaDto } from "./work-area-manager";

// Vitest compiles this existing client component with the classic JSX runtime.
Object.assign(globalThis, { React });

function area(overrides: Partial<WorkAreaDto> = {}): WorkAreaDto {
  return {
    id: "area-1",
    name: "People",
    description: null,
    displayOrder: 0,
    isArchived: false,
    projectCount: 0,
    caseStudyCount: 0,
    ...overrides,
  };
}

function render(initialAreas: WorkAreaDto[], canMutate: boolean) {
  return renderToStaticMarkup(
    React.createElement(WorkAreaManager, { initialAreas, canMutate }),
  );
}

describe("WorkAreaManager permissions and delete affordance", () => {
  it("renders a read-only view when mutation is not authorized", () => {
    const html = render([area()], false);

    expect(html).toContain("People");
    expect(html).not.toContain("Work area name");
    expect(html).not.toContain("Name for People");
    expect(html).not.toContain(">Archive<");
    expect(html).not.toContain(">Delete<");
  });

  it("offers permanent deletion for an empty area", () => {
    const html = render([area()], true);

    expect(html).toContain(">Delete<");
    expect(html).toContain('aria-label="Delete People"');
    expect(html).not.toContain('aria-label="Delete People" disabled=""');
  });

  it("disables deletion and recommends archiving when the area is used", () => {
    const html = render(
      [area({ projectCount: 2, caseStudyCount: 1 })],
      true,
    );

    expect(html).toContain('aria-label="Delete People"');
    expect(html).toContain("disabled");
    expect(html).toContain("Archive this area instead");
  });
});
