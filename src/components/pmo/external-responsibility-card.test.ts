import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExternalResponsibilityCard } from "./external-responsibility-card";

Object.assign(globalThis, { React });

describe("ExternalResponsibilityCard", () => {
  it("keeps semantic fields and text directions explicit", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExternalResponsibilityCard, {
        owner: { name: "نورة Al-Qahtani صاحبة الاسم الطويل" },
        contact: {
          name: "John المسؤول الخارجي ذو الاسم الطويل",
          email: "very.long.external.contact@example.com",
          department: "إدارة تجربة الموظف Employee Experience",
          organization: null,
        },
        parentName: "القيادة الشمولية Inclusive Leadership",
        workAreaName: "تجربة الموظف",
        cancellationReason: null,
      }),
    );

    expect(html).toContain("<dl");
    expect(html.match(/<dt/g)).toHaveLength(7);
    expect(html.match(/<dd/g)).toHaveLength(7);
    expect(html).toContain('dir="auto"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Organization");
    expect(html).toContain("—");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("md:grid-cols-2");
  });

  it("renders a full-width cancellation reason only when present", () => {
    const base = {
      owner: { name: "Owner" },
      contact: {
        name: "Contact",
        email: "contact@example.com",
        department: null,
        organization: null,
      },
      parentName: "Parent",
      workAreaName: "Area",
    };

    const active = renderToStaticMarkup(
      React.createElement(ExternalResponsibilityCard, {
        ...base,
        cancellationReason: null,
      }),
    );
    const canceled = renderToStaticMarkup(
      React.createElement(ExternalResponsibilityCard, {
        ...base,
        cancellationReason: "أُلغي بطلب الجهة External request",
      }),
    );

    expect(active).not.toContain("Cancellation reason");
    expect(canceled).toContain("Cancellation reason");
    expect(canceled).toContain("md:col-span-2");
  });
});
