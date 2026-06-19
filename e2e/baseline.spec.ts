import { expect, test } from "@playwright/test";

test("shows the SmallCalc baseline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "SmallCalc" })).toBeVisible();
});
