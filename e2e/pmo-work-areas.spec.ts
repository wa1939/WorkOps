import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { pmoName, withPmoPrisma } from "./helpers/pmo";

async function createArea(page: Page, scenario: string) {
  const response = await page.request.post("/api/pmo/work-areas", {
    data: { name: pmoName(scenario) },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function relogin(page: Page, role: "admin" | "member" | "viewer") {
  await page.context().clearCookies();
  await loginAs(page, role);
}

test.describe.serial("PMO work area deletion", () => {
  test.beforeEach(async ({ page }) => loginAs(page, "admin"));

  test("enforces authorization, references, deletion, and auditing", async ({
    page,
  }) => {
    const empty = await createArea(page, "delete-api-empty");
    const used = await createArea(page, "delete-api-used");
    const protectedArea = await createArea(page, "delete-api-permission");
    const projectId = pmoName("delete-api-project");

    await withPmoPrisma((prisma) =>
      prisma.project.create({
        data: { id: projectId, name: projectId, workAreaId: used.id },
      }),
    );

    try {
      await relogin(page, "member");
      expect(
        (
          await page.request.delete(
            `/api/pmo/work-areas/${protectedArea.id}`,
          )
        ).status(),
      ).toBe(403);

      await relogin(page, "viewer");
      expect(
        (
          await page.request.delete(
            `/api/pmo/work-areas/${protectedArea.id}`,
          )
        ).status(),
      ).toBe(403);

      await relogin(page, "admin");
      const blocked = await page.request.delete(
        `/api/pmo/work-areas/${used.id}`,
      );
      expect(blocked.status()).toBe(409);
      expect(await blocked.json()).toMatchObject({
        projectCount: 1,
        caseStudyCount: 0,
        recommendation: "archive",
      });

      const deleted = await page.request.delete(
        `/api/pmo/work-areas/${empty.id}`,
      );
      expect(deleted.status()).toBe(200);
      expect(await deleted.json()).toEqual({ id: empty.id });

      await withPmoPrisma(async (prisma) => {
        expect(
          await prisma.workArea.findUnique({ where: { id: empty.id } }),
        ).toBeNull();
        expect(
          await prisma.auditLog.findFirst({
            where: {
              entityType: "work_area",
              entityId: empty.id,
              action: "delete",
            },
          }),
        ).toMatchObject({ actorId: expect.any(String) });
      });
    } finally {
      await withPmoPrisma(async (prisma) => {
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.workArea.deleteMany({
          where: { id: { in: [used.id, protectedArea.id] } },
        });
      });
    }
  });

  test("confirms empty deletion and explains why used areas must be archived", async ({
    page,
  }) => {
    const empty = await createArea(page, "delete-browser-empty");
    const used = await createArea(page, "delete-browser-used");
    const projectId = pmoName("delete-browser-project");
    await withPmoPrisma((prisma) =>
      prisma.project.create({
        data: { id: projectId, name: projectId, workAreaId: used.id },
      }),
    );

    try {
      await page.goto("/pmo/settings?tab=areas");
      await expect(page.getByLabel(`Name for ${empty.name}`)).toBeVisible();

      await page.getByRole("button", { name: `Delete ${empty.name}` }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText(empty.name);
      await expect(dialog).toContainText(/permanently/i);
      await expect(dialog).toContainText("Archive");
      await expect(dialog.getByRole("button", { name: "Keep area" })).toBeVisible();
      await dialog.getByRole("button", { name: "Delete permanently" }).click();
      await expect(page.getByLabel(`Name for ${empty.name}`)).toHaveCount(0);

      const usedDelete = page.getByRole("button", {
        name: `Delete ${used.name}`,
      });
      await expect(usedDelete).toBeDisabled();
      await expect(
        usedDelete.locator("xpath=..").getByText(/Archive this area instead/),
      ).toBeVisible();
    } finally {
      await withPmoPrisma(async (prisma) => {
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.workArea.deleteMany({
          where: { id: { in: [empty.id, used.id] } },
        });
      });
    }
  });

  test("keeps the delete confirmation usable on mobile", async ({ page }) => {
    const empty = await createArea(page, "delete-browser-mobile");
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/pmo/settings?tab=areas");
      await page.getByRole("button", { name: `Delete ${empty.name}` }).click();

      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Keep area" })).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Delete permanently" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    } finally {
      await withPmoPrisma((prisma) =>
        prisma.workArea.deleteMany({ where: { id: empty.id } }),
      );
    }
  });
});
