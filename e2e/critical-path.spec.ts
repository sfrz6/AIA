import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./global-setup";

/**
 * The critical competition workflow, end to end, through the real interface:
 * sign in, build a template, create a championship with two squads, confirm the
 * entry orders, print the round sheet, score the run, confirm it, read the
 * standings, correct a confirmed score with a reason, and check that the public
 * results and the audit log both follow.
 *
 * The suite runs serially against a dedicated database so each step can rely on
 * the state the previous one left.
 */
test.describe.configure({ mode: "serial" });

const TEMPLATE_NAME = "E2E qualifier structure";
const CHAMPIONSHIP_NAME = "E2E World Cup Qualifier 2026";

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("User name").fill(E2E_ADMIN.username);
  await page.getByLabel("Password", { exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("admin can sign in", async ({ page }) => {
  await signIn(page);
  // The navigation reflects the administrator's full set of capabilities.
  await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit log" })).toBeVisible();
});

test("a deactivated account cannot sign in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("User name").fill(E2E_ADMIN.username);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").or(page.getByText(/not correct/i))).toBeVisible();
  await expect(page).toHaveURL(/sign-in/);
});

test("create a championship template", async ({ page }) => {
  await signIn(page);
  await page.goto("/templates/new");

  await page.getByLabel("Template name").fill(TEMPLATE_NAME);

  // Day 1 holds an individual event and a team event, so the run covers both
  // penalty attributions.
  await page.getByLabel("Add event, Day 1").selectOption("INDIVIDUAL_LANCE");
  await page.getByRole("button", { name: "Add event" }).first().click();
  await page.getByLabel("Add event, Day 1").selectOption("TEAM_LANCE");
  await page.getByRole("button", { name: "Add event" }).first().click();

  // The move control carries the event name, which makes it a unique and
  // meaningful handle on the event row.
  await expect(page.getByRole("button", { name: "Move up: Individual Lance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move up: Team Lance" })).toBeVisible();

  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(/Template created/i)).toBeVisible();
});

test("create a championship from the template", async ({ page }) => {
  await signIn(page);
  await page.goto("/championships/new");

  // Step 1: template.
  await page.getByRole("button", { name: new RegExp(TEMPLATE_NAME, "i") }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 2: details.
  await page.getByLabel("Championship name", { exact: true }).fill(CHAMPIONSHIP_NAME);
  await page.getByLabel("Start date").fill("2026-09-18");
  await page.getByLabel("Location").fill("Amman");
  await page.getByLabel("Organizer").fill("Royal Jordanian Equestrian Federation");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3: countries.
  await page.getByLabel("Search").fill("Jordan");
  await page.getByRole("checkbox").first().check();
  await page.getByLabel("Search").fill("Oman");
  await page.getByRole("checkbox").first().check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 4: squads. Each country is an accordion, so it has to be opened before
  // its riders can be nominated. Each country is seeded with four riders, so the
  // fifth is added here, which exercises the "add rider" path in the wizard.
  for (const country of ["Jordan", "Oman"] as const) {
    const prefix = country === "Jordan" ? "JO" : "OM";

    await page.getByRole("button", { name: new RegExp(`^${country}`) }).click();
    await expect(page.getByLabel("Rider name")).toBeVisible();

    await page.getByLabel("Rider name").fill(`${prefix} Reserve Rider`);
    await page.getByRole("button", { name: "Add rider" }).click();
    await expect(page.getByLabel(`${prefix} Reserve Rider, ${country}`)).toBeVisible();

    for (let position = 1; position <= 4; position += 1) {
      await page
        .getByLabel(`${prefix} Rider ${position}, ${country}`)
        .selectOption(String(position));
    }
    await page.getByLabel(`${prefix} Reserve Rider, ${country}`).selectOption("RESERVE");

    // Collapse it again so the next country's controls are unambiguous.
    await page.getByRole("button", { name: new RegExp(`^${country}`) }).click();
  }

  await page.getByRole("button", { name: "Next" }).click();

  // Step 5: review and create.
  await expect(page.getByText(CHAMPIONSHIP_NAME)).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("heading", { name: CHAMPIONSHIP_NAME })).toBeVisible();
  // Three competition days are always created, even when a day has no events.
  await expect(page.getByText("Day 1 of 3")).toBeVisible();
  await expect(page.getByText("Day 3 of 3")).toBeVisible();
});

test("squads are four active riders plus one reserve", async ({ page }) => {
  await signIn(page);
  await openChampionship(page);
  await championshipTab(page, "Participants").click();

  await expect(page.getByText("Active riders").first()).toBeVisible();
  await expect(page.getByText("Reserve rider").first()).toBeVisible();
  await expect(page.getByText("JO Reserve Rider")).toBeVisible();
  await expect(page.getByText("OM Reserve Rider")).toBeVisible();
});

/** Opens the first run of the first event of the championship. */
async function openChampionship(page: Page): Promise<void> {
  await page.goto("/championships");
  await page.getByRole("link", { name: new RegExp(CHAMPIONSHIP_NAME, "i") }).click();
  await expect(page.getByRole("heading", { name: CHAMPIONSHIP_NAME })).toBeVisible();
}

/** The championship's own tab strip, which shares labels with the main menu. */
function championshipTab(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Overview" }).getByRole("link", { name });
}

async function openFirstRun(page: Page): Promise<void> {
  await openChampionship(page);
  // Addressed by its destination rather than its label, because the label also
  // carries the peg size, the time limit and the current status.
  const firstRun = page.locator('a[href*="/runs/"]').first();
  await expect(firstRun).toBeVisible();
  await firstRun.click();
  await expect(page.getByRole("heading", { level: 2, name: /Individual Lance/ })).toBeVisible();
}

test("confirm the entry orders, print the sheet, and start the run", async ({ page }) => {
  await signIn(page);
  await openFirstRun(page);

  await expect(page.getByText("0 of 2 countries confirmed")).toBeVisible();

  // Every country needs an explicit decision; nothing is assumed.
  const confirmButtons = page.getByRole("button", { name: "Confirm", exact: true });
  await confirmButtons.first().click();
  await expect(page.getByText("1 of 2 countries confirmed")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  await expect(page.getByText("2 of 2 countries confirmed")).toBeVisible();

  await expect(page.getByText("Ready to start")).toBeVisible();
  await expect(page.getByRole("link", { name: "Print round sheet" })).toBeVisible();

  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByText("Scoring in progress")).toBeVisible();
});

test("the printed round sheet matches the confirmed entry order", async ({ page, context }) => {
  await signIn(page);
  await openFirstRun(page);

  const href = await page.getByRole("link", { name: "Print round sheet" }).getAttribute("href");
  expect(href).toBeTruthy();

  const sheet = await context.newPage();
  await sheet.goto(href!);

  await expect(sheet.getByText("Round sheet")).toBeVisible();
  await expect(sheet.getByText("International Tent Pegging Federation")).toBeVisible();
  await expect(sheet.getByText("Individual Lance")).toBeVisible();
  // The first rider of each squad, in the confirmed order.
  await expect(sheet.getByText("JO Rider 1")).toBeVisible();
  await expect(sheet.getByText("OM Rider 1")).toBeVisible();
  // The reserve did not ride, so it must not appear on the sheet.
  await expect(sheet.getByText("JO Reserve Rider")).toHaveCount(0);
  await sheet.close();
});

test("enter scores and confirm the run", async ({ page }) => {
  await signIn(page);
  await openFirstRun(page);

  // Award 6 points to every rider and record a time inside the 6.40 s limit for
  // all but one, who is one started second over and so loses half a point.
  // Scoped to the Scoring section: the entry order panel can still be showing
  // at this point too (nothing has been saved for the run yet), and its own
  // "no change / change order" control is a radiogroup as well.
  const scoringSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Scoring" }) });
  const groups = scoringSection.getByRole("radiogroup");
  const groupCount = await groups.count();
  expect(groupCount).toBe(8);
  for (let index = 0; index < groupCount; index += 1) {
    await groups.nth(index).getByRole("radio", { name: "6" }).click();
  }

  const times = scoringSection.getByRole("textbox", { name: /Time$/ });
  const timeCount = await times.count();
  expect(timeCount).toBe(8);
  for (let index = 0; index < timeCount; index += 1) {
    await times.nth(index).fill(index === 0 ? "7.40" : "6.00");
  }

  await scoringSection.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Scores saved/i)).toBeVisible();
  await expect(page.getByText("Awaiting review")).toBeVisible();

  await page.getByRole("button", { name: "Confirm run" }).click();
  await page.getByRole("button", { name: "Confirm run" }).last().click();
  await expect(page.getByText(/Run confirmed/i)).toBeVisible();
  await expect(page.getByText("Confirmed").first()).toBeVisible();
});

test("the standings reflect the confirmed run", async ({ page }) => {
  await signIn(page);
  await openChampionship(page);
  await championshipTab(page, "Results").click();

  await expect(page.getByText(/Only confirmed runs are included/i)).toBeVisible();

  // Seven riders scored a clean 6, and one lost half a point to the clock.
  await expect(page.getByText("5.5").first()).toBeVisible();
  // The standings table shortens a rider's name to first + last.
  await expect(page.getByText("JO 1")).toBeVisible();
});

test("an unconfirmed run stays out of the standings", async ({ page }) => {
  await signIn(page);
  await openChampionship(page);

  // The lineup can only change once per event: confirming Run 1 of the
  // individual event already carried its entry order into Run 2
  // automatically, so Run 2 is ready rather than still pending. The team
  // event was never touched at all, so it is still awaiting its own entry
  // order.
  await expect(page.getByText("Ready to start").first()).toBeVisible();
  await expect(page.getByText("Entry orders pending").first()).toBeVisible();

  await championshipTab(page, "Results").click();
  await page
    .getByRole("radiogroup", { name: "Show individual or country standings" })
    .getByRole("radio", { name: "Individual" })
    .click();

  // Exactly the 6 points awarded in the one confirmed run. Had the unscored
  // runs leaked in, this rider would be on 12 or more. The standings table
  // shortens a rider's name to first + last.
  const row = page.getByRole("row").filter({ hasText: "OM 2" });
  await expect(row).toContainText("6");
  await expect(row).not.toContainText("12");
});

test("correct a confirmed score with a mandatory reason", async ({ page }) => {
  await signIn(page);
  await openFirstRun(page);

  await page.getByRole("button", { name: "Edit confirmed result" }).click();
  await expect(page.getByText(/Corrections are recorded/i)).toBeVisible();

  // Lower the first rider's score, which must also recompute the standings.
  await page.getByRole("radiogroup").first().getByRole("radio", { name: "2" }).click();

  // Saving without a reason must be refused.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/reason is required/i)).toBeVisible();

  await page
    .getByLabel("Reason for the correction")
    .fill("Paper referee recorded two points for the first rider.");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(/Correction saved/i)).toBeVisible();
  await expect(page.getByText("Correction history")).toBeVisible();
  await expect(page.getByText(/Paper referee recorded two points/i)).toBeVisible();
});

test("the standings recalculate after the correction", async ({ page }) => {
  await signIn(page);
  await openChampionship(page);
  await championshipTab(page, "Results").click();

  // 2 points less 0.5 for the time leaves 1.5 for the corrected rider.
  await expect(page.getByText("1.5").first()).toBeVisible();
  await expect(page.getByText("5.5")).toHaveCount(0);
});

test("the audit log records the whole workflow", async ({ page }) => {
  await signIn(page);
  await page.goto("/audit");

  for (const action of [
    "Championship created",
    "Entry order confirmed",
    "Run started",
    "Run confirmed",
    "Run corrected",
  ]) {
    await expect(page.getByText(action).first()).toBeVisible();
  }
  await expect(page.getByText(/Paper referee recorded two points/i).first()).toBeVisible();
});

test("public results show nothing until the championship is published", async ({ page }) => {
  await page.goto("/results");
  await expect(page.getByText(/No results have been published/i)).toBeVisible();
  await expect(page.getByText(CHAMPIONSHIP_NAME)).toHaveCount(0);
});

test("publishing exposes the confirmed results publicly", async ({ page, context }) => {
  await signIn(page);
  await openChampionship(page);
  await page.getByRole("button", { name: "Publish results" }).click();
  await expect(page.getByText(/Championship updated/i)).toBeVisible();

  // Signed out, from a fresh browser context.
  const anonymous = await context.browser()!.newContext();
  const visitor = await anonymous.newPage();
  await visitor.goto("/results");
  await expect(visitor.getByText(CHAMPIONSHIP_NAME)).toBeVisible();

  await visitor.getByRole("link", { name: /View results/i }).first().click();
  await expect(visitor.getByText("Amman")).toBeVisible();
  // "Individual Lance" appears twice: as the last confirmed run (run 1) and as
  // the next run due (run 2), so it is addressed by its row rather than by
  // its own text.
  await expect(visitor.getByText("Last confirmed")).toBeVisible();
  await expect(visitor.getByText("Next run")).toBeVisible();
  await expect(visitor.getByText("Individual Lance").first()).toBeVisible();
  // The standings table shortens a rider's name to first + last.
  await expect(visitor.getByText("JO 2")).toBeVisible();
  await expect(visitor.getByText(/results update as each run is confirmed/i)).toBeVisible();

  await anonymous.close();
});

test("a non administrator cannot reach user management", async ({ page }) => {
  await signIn(page);

  // Create a scoring-only operator.
  await page.goto("/users");
  await page.getByRole("button", { name: "New user" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Scoring operator");
  await dialog.getByLabel("User name").fill("e2e-operator");
  await dialog.getByLabel("Password", { exact: true }).fill("OperatorPass!2026");
  await dialog.getByRole("checkbox", { name: "Enter scores" }).check();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(/User created/i)).toBeVisible();

  // Sign out and back in as the operator.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel("User name").fill("e2e-operator");
  await page.getByLabel("Password", { exact: true }).fill("OperatorPass!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // The navigation hides it, and the route itself refuses.
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  await page.goto("/users");
  await expect(page.getByText(/do not have permission/i)).toBeVisible();

  await page.goto("/templates");
  await expect(page.getByText(/do not have permission/i)).toBeVisible();
});
