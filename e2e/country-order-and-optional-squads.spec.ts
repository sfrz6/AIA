import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * Two related workflows, both revolving around a championship whose squads are
 * not all decided at creation time:
 *
 * 1. The wizard lets a country's squad be left empty, and the Participants page
 *    lets it be filled in afterwards, any time before that country rides.
 * 2. The country start list order can be rearranged from Participants, and the
 *    new order is reflected on the entry order screen immediately.
 *
 * Self-contained: it registers its own extra rider for each country rather
 * than assuming another spec file ran first, because Playwright does not
 * guarantee an order between spec files.
 */
test.describe.configure({ mode: "serial" });

const TEMPLATE_NAME = "E2E order template";
const CHAMPIONSHIP_NAME = "E2E Country Order And Optional Squads";

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("User name").fill(E2E_ADMIN.username);
  await page.getByLabel("Password", { exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("create the template this spec uses", async ({ page }) => {
  await signIn(page);
  await page.goto("/templates/new");
  await page.getByLabel("Template name").fill(TEMPLATE_NAME);
  await page.getByLabel("Add event, Day 1").selectOption("INDIVIDUAL_LANCE");
  await page.getByRole("button", { name: "Add event" }).first().click();
  await expect(page.getByRole("button", { name: "Move up: Individual Lance" })).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(/Template created/i)).toBeVisible();
});

test("the wizard lets a country's squad be left empty", async ({ page }) => {
  await signIn(page);
  await page.goto("/championships/new");

  await page.getByRole("button", { name: new RegExp(TEMPLATE_NAME, "i") }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Championship name", { exact: true }).fill(CHAMPIONSHIP_NAME);
  await page.getByLabel("Start date").fill("2026-10-01");
  await page.getByLabel("Location").fill("Muscat");
  await page.getByRole("button", { name: "Next" }).click();

  // Selected in this order, so Jordan starts as team 1 and Oman as team 2.
  await page.getByLabel("Search").fill("Jordan");
  await page.getByRole("checkbox").first().check();
  await page.getByLabel("Search").fill("Oman");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Next" }).click();

  // Jordan gets a full squad: the four base riders from the registry, plus a
  // reserve added here through the squad picker's own "Add rider" form.
  await page.getByRole("button", { name: /^Jordan/ }).click();
  await page.getByLabel("Rider name").fill("JO Spare Rider");
  await page.getByRole("button", { name: "Add rider" }).click();
  await expect(page.getByLabel("JO Spare Rider, Jordan")).toBeVisible();
  for (let position = 1; position <= 4; position += 1) {
    await page.getByLabel(`JO Rider ${position}, Jordan`).selectOption(String(position));
  }
  await page.getByLabel("JO Spare Rider, Jordan").selectOption("RESERVE");

  // Oman is left untouched: its accordion is never opened, so no rider is
  // selected. The wizard must still allow moving on.
  await expect(page.getByText("Riders not selected yet")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // The review step explains the squad will be added later, not a blank list.
  await expect(page.getByRole("heading", { name: "Review and create" })).toBeVisible();
  await expect(page.getByText("Riders not selected yet")).toBeVisible();

  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: CHAMPIONSHIP_NAME })).toBeVisible();
});

test("the entry order screen explains a country still needs its squad, with a link to fix it", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/championships");
  await page.getByRole("link", { name: new RegExp(CHAMPIONSHIP_NAME, "i") }).click();

  const firstRun = page.locator('a[href*="/runs/"]').first();
  await firstRun.click();

  await expect(page.getByText(/needs 4 active riders/i)).toBeVisible();
  const fixLink = page.getByRole("link", { name: "Add riders in Participants" });
  await expect(fixLink).toBeVisible();
  await fixLink.click();

  await expect(page).toHaveURL(/\/participants$/);
});

test("riders can be added for a country after the championship was created", async ({ page }) => {
  await signIn(page);
  await page.goto("/championships");
  await page.getByRole("link", { name: new RegExp(CHAMPIONSHIP_NAME, "i") }).click();
  await page.getByRole("link", { name: "Participants" }).click();

  await expect(page.getByText("Riders not selected yet")).toBeVisible();

  await page.getByRole("button", { name: "Edit: Oman" }).click();
  await page.getByLabel("Rider name").fill("OM Spare Rider");
  await page.getByRole("button", { name: "Add rider" }).click();
  await expect(page.getByLabel("OM Spare Rider, Oman")).toBeVisible();
  for (let position = 1; position <= 4; position += 1) {
    await page.getByLabel(`OM Rider ${position}, Oman`).selectOption(String(position));
  }
  await page.getByLabel("OM Spare Rider, Oman").selectOption("RESERVE");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText(/updated/i)).toBeVisible();
  await expect(page.getByText("Riders not selected yet")).toHaveCount(0);
  await expect(page.getByText("OM Rider 1")).toBeVisible();
});

test("the country start list order can be changed before the first run, and is used everywhere", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/championships");
  await page.getByRole("link", { name: new RegExp(CHAMPIONSHIP_NAME, "i") }).click();
  await page.getByRole("link", { name: "Participants" }).click();
  await expect(page.getByText("OM Rider 1")).toBeVisible();

  const before = await page.locator("main").innerText();
  expect(before.indexOf("Jordan")).toBeGreaterThanOrEqual(0);
  expect(before.indexOf("Oman")).toBeGreaterThanOrEqual(0);
  expect(before.indexOf("Jordan")).toBeLessThan(before.indexOf("Oman"));

  await page.getByRole("button", { name: "Move down: Jordan" }).click();

  await expect(async () => {
    const after = await page.locator("main").innerText();
    expect(after.indexOf("Oman")).toBeLessThan(after.indexOf("Jordan"));
  }).toPass();

  // The new order survives a reload, and feeds the entry order screen too.
  await page.reload();
  const reloaded = await page.locator("main").innerText();
  expect(reloaded.indexOf("Oman")).toBeLessThan(reloaded.indexOf("Jordan"));

  await page.goto("/championships");
  await page.getByRole("link", { name: new RegExp(CHAMPIONSHIP_NAME, "i") }).click();
  const firstRun = page.locator('a[href*="/runs/"]').first();
  await firstRun.click();
  await expect(page.getByText(/countries confirmed/)).toBeVisible();
  const runPageText = await page.locator("main").innerText();
  expect(runPageText.indexOf("Oman")).toBeGreaterThanOrEqual(0);
  expect(runPageText.indexOf("Jordan")).toBeGreaterThanOrEqual(0);
  expect(runPageText.indexOf("Oman")).toBeLessThan(runPageText.indexOf("Jordan"));
});

test("the order locks once the championship's first run starts", async ({ page }) => {
  await signIn(page);
  await page.goto("/championships");
  await page.getByRole("link", { name: new RegExp(CHAMPIONSHIP_NAME, "i") }).click();

  const firstRun = page.locator('a[href*="/runs/"]').first();
  await firstRun.click();

  // Both countries now have full squads: confirm "no change" for each and
  // start the run.
  const confirmButtons = page.getByRole("button", { name: "Confirm", exact: true });
  await confirmButtons.first().click();
  await expect(page.getByText("1 of 2 countries confirmed")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  await expect(page.getByText("2 of 2 countries confirmed")).toBeVisible();
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByText("Scoring in progress")).toBeVisible();

  await page.getByRole("link", { name: "Participants" }).click();
  await expect(page.getByText(/country order is now locked/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move (up|down):/ })).toHaveCount(0);
});
