import { chromium } from "@playwright/test";

const OUT =
  "/private/tmp/claude-501/-Users-olivierveinand-Documents-DEV-dynamique-chimie/139ebf41-5542-4caf-afd9-e93b84c7af29/scratchpad";
const browser = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:4173", { waitUntil: "load" });
await page.waitForTimeout(2500);
const fps = async () =>
  (
    await page
      .locator('[data-testid^="metric-"]')
      .allTextContents()
      .catch(() => [])
  )[0];
// Droplet
await page
  .getByRole("button", { name: /Tension de surface/ })
  .click()
  .catch(() => {});
await page.waitForTimeout(34000);
await page.screenshot({ path: `${OUT}/drop3.png` });
console.log(
  "droplet:",
  (
    await page
      .locator('[data-testid^="metric-"]')
      .allTextContents()
      .catch(() => [])
  ).join(" | "),
);
// Oil-water FPS (cell-list benefit on spread column)
await page
  .getByRole("button", { name: /Huile \+ Eau/ })
  .click()
  .catch(() => {});
await page.waitForTimeout(6000);
console.log("oil-water FPS:", await fps());
console.log("ERRORS:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
