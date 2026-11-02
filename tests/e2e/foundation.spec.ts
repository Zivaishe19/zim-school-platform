import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Demo-Password-2026!";

async function signIn(page: Page, identifier: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(identifier);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(schools|s\/[a-z0-9-]+)$/);
}

test("multi-school user picks a school and sees only that school's students", async ({ page }) => {
  await signIn(page, "support@multi.example.test");
  await expect(page.getByRole("heading", { name: "Choose a school" })).toBeVisible();
  await page.getByRole("link", { name: /Umguza Valley/ }).click();
  await page.getByRole("navigation", { name: "School" }).getByRole("link", { name: "Students" }).click();
  await expect(page.getByRole("cell", { name: /^UV\// }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /^KH\// })).toHaveCount(0);
});

test("wrong password shows a generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill("nobody@example.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /not correct|Too many attempts/ })).toBeVisible();
});

test("student signs in with a username and sees only their own record", async ({ page }) => {
  await signIn(page, "rumbi.chikwanha");
  await expect(page).toHaveURL(/\/s\/kopje-heights$/);
  await page.getByRole("navigation", { name: "School" }).getByRole("link", { name: "Students" }).click();
  await expect(page.getByRole("row")).toHaveCount(2); // header + own record
});

test("headmaster of one school gets 404 for the other school", async ({ page }) => {
  await signIn(page, "head@kopje.example.test");
  await expect(page).toHaveURL(/\/s\/kopje-heights$/);
  const res = await page.goto("/s/umguza-valley/students");
  expect(res?.status()).toBe(404);
});

test("school admin adds a student and it appears in their school", async ({ page }) => {
  await signIn(page, "admin@umguza.example.test");
  await page.goto("/s/umguza-valley/students/new");
  const adm = `UV/E2E/${Date.now().toString().slice(-6)}`;
  await page.getByLabel("Admission number").fill(adm);
  await page.getByLabel("First name").fill("End");
  await page.getByLabel("Last name").fill("ToEnd");
  await page.getByRole("button", { name: "Save student" }).click();
  await expect(page.getByRole("heading", { name: "End ToEnd" })).toBeVisible();
  await expect(page.getByText(`Admission number ${adm}`)).toBeVisible();
});
