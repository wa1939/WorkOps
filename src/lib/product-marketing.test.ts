import { describe, expect, it } from "vitest";
import { createProductStructuredData, productFaqs } from "./product-marketing";

describe("public product structured data", () => {
    it("separates the application from its source-code repository", () => {
        const data = createProductStructuredData("https://workops.example");
        const app = data["@graph"].find(node => node["@type"] === "SoftwareApplication")!;
        const source = data["@graph"].find(node => node["@type"] === "SoftwareSourceCode")!;
        expect(app).not.toHaveProperty("codeRepository");
        expect(source).toHaveProperty("codeRepository", "https://github.com/wa1939/WorkOps");
        expect(app).toHaveProperty("url", "https://workops.example/");
        expect(JSON.stringify(data)).toContain("Workload");
        expect(JSON.stringify(data)).not.toMatch(/aggregateRating|ratingValue|reviewCount/);
    });

    it("omits a site URL when no public origin is configured", () => {
        const app = createProductStructuredData(null)["@graph"].find(node => node["@type"] === "SoftwareApplication")!;
        expect(app).not.toHaveProperty("url");
        expect(JSON.stringify(app)).not.toContain("localhost");
    });

    it("explains provider and hosting costs without claiming a hosted demo", () => {
        const answers = productFaqs.map(item => item.answer).join(" ");
        expect(answers).toMatch(/hosting/i);
        expect(answers).toMatch(/provider/i);
        expect(answers).toMatch(/optional/i);
        expect(new Set(productFaqs.map(item => item.question)).size).toBe(productFaqs.length);
    });
});
