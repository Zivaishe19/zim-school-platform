import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Demo-Password-2026!";

async function signIn(page: Page, identifier: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(identifier);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(schools|s\/[a-z0-9-]+)$/);
}

test("class teacher takes the daily register on a phone", async ({ page }) => {
  await signIn(page, "teacher@kopje.example.test");
  await page.getByRole("navigation", { name: "School" }).getByRole("link", { name: "Attendance" }).click();
  await page.getByLabel("Register", { exact: true }).selectOption({ label: "Daily – 1 Blue" });
  await page.getByRole("button", { name: "Open register" }).click();
  await expect(page.getByRole("heading", { name: "Daily register" })).toBeVisible();
  await page.locator('fieldset').first().getByText("A", { exact: true }).click();
  await page.getByRole("button", { name: "Save register" }).click();
  await expect(page.getByRole("status")).toContainText("Register saved");
});

test("parent sees only their children, uploads proof, and it is not credited until accounts verifies", async ({ page, browser }) => {
  await signIn(page, "parent@kopje.example.test");
  await expect(page.getByRole("heading", { name: "My children" })).toBeVisible();
  await page.getByRole("navigation", { name: "School" }).getByRole("link", { name: "Fees" }).click();
  await page.waitForURL(/\/fees$/);
  await page.getByRole("main").getByRole("link").first().click();
  await page.waitForURL(/\/fees\/student\//);
  const balanceBefore = await page.getByText(/Balance \(USD\)/).locator("..").textContent();
  await page.getByText("Upload proof of payment").click();
  await page.getByLabel("Amount paid").fill("50");
  await page.getByLabel("Transaction reference").fill(`E2E-${Date.now()}`);
  await page.locator('input[name="file"]').setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await page.getByRole("button", { name: "Send proof" }).click();
  await expect(page.getByRole("status")).toContainText("only after verification");
  expect(await page.getByText(/Balance \(USD\)/).locator("..").textContent()).toBe(balanceBefore);

  const acc = await (await browser.newContext()).newPage();
  await signIn(acc, "accounts@kopje.example.test");
  await acc.goto("/s/kopje-heights/fees/proofs");
  await acc.getByRole("button", { name: "Verify and credit" }).first().click();
  await expect(acc.getByRole("status")).toContainText("Proof reviewed");
});

test("parent opens a published report card; another student's id is a 404", async ({ page }) => {
  await signIn(page, "parent@kopje.example.test");
  await page.getByRole("navigation", { name: "School" }).getByRole("link", { name: "Reports" }).click();
  const link = page.getByRole("link", { name: /^Term/ }).first();
  await link.click();
  await expect(page.getByRole("heading", { name: /Report card/ })).toBeVisible();
  const res = await page.goto("/s/kopje-heights/students/00000000-0000-4000-8000-000000000000");
  expect(res?.status()).toBe(404);
});

test("student sees their learning page and cannot open staff areas", async ({ page }) => {
  await signIn(page, "rumbi.chikwanha");
  await page.getByRole("navigation", { name: "School" }).getByRole("link", { name: "My learning" }).click();
  await expect(page.getByRole("heading", { name: "My learning" })).toBeVisible();
  for (const path of ["/setup", "/people", "/fees/proofs", "/admissions", "/library"]) {
    const res = await page.goto(`/s/kopje-heights${path}`);
    expect(res?.status(), path).toBe(404);
  }
});

test("headmaster approves a submitted report", async ({ page }) => {
  await signIn(page, "head@kopje.example.test");
  await page.goto("/s/kopje-heights/reports");
  await page.getByLabel("Headmaster's comment").first().fill("Good term.");
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByRole("status")).toContainText("approved");
});

test("public online application form works without signing in", async ({ page }) => {
  await page.goto("/apply/kopje-heights");
  await page.getByLabel("Learner's first name").fill("Online");
  await page.getByLabel("Learner's last name").fill("Applicant");
  await page.getByLabel("Parent/guardian name").fill("Parent Person");
  await page.getByLabel("Parent/guardian phone").fill("+263 77 555 0000");
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText(/application reference is/)).toBeVisible();
});
