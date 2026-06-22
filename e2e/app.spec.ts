import { expect, test } from "@playwright/test";

test("the app shell loads and resolves an engine status", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dynamique-Chimie" })).toBeVisible();

  const status = page.getByTestId("engine-status");
  await expect(status).toBeVisible();

  // The engine must leave the transient "initializing" state and settle on a
  // terminal status (running / unsupported / error) — never hang blank.
  await expect
    .poll(async () => (await status.textContent())?.trim() ?? "", {
      timeout: 15_000,
    })
    .not.toBe("Initialisation du moteur…");

  // Control panel and viewport are present regardless of WebGPU availability.
  await expect(page.locator(".canvas-host")).toBeVisible();
  await expect(page.getByRole("button", { name: /Lecture|Pause/ })).toBeVisible();

  const statusText = (await status.textContent())?.trim();
  console.log(`Engine status: ${statusText}`);

  // No uncaught exceptions (WebGPU-unavailable is handled gracefully, not thrown).
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

test("simulation advances when WebGPU is available", async ({ page }) => {
  await page.goto("/");
  const status = page.getByTestId("engine-status");
  await expect(status).toBeVisible();
  await expect
    .poll(async () => (await status.textContent())?.trim() ?? "", {
      timeout: 15_000,
    })
    .not.toBe("Initialisation du moteur…");

  const running = (await status.textContent())?.includes("WebGPU actif");
  test.skip(!running, "WebGPU not available in this environment");

  // Start playback and confirm the step counter advances — proving the full
  // engine → render-loop → observable-sampling pipeline runs end to end.
  await page.getByRole("button", { name: /Lecture/ }).click();
  const stepMetric = page.getByTestId("metric-step");
  await expect
    .poll(async () => Number(await stepMetric.textContent()), { timeout: 5000 })
    .toBeGreaterThan(0);
});
