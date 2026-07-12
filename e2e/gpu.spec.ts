import { expect, test } from "@playwright/test";

/**
 * GPU backend validation.
 *
 * The behavioural test below runs the WebGPU compute → render pipeline for real and
 * needs no buffer readback, so it works in headless Chromium. The readback-based
 * parity checks (vs the CPU oracle) rely on WebGPU `mapAsync`, which does not resolve
 * in headless Chromium — they are skipped here and meant for a real browser.
 */

async function gpuAvailable(page: import("@playwright/test").Page): Promise<boolean> {
  await page.goto("/");
  const status = page.getByTestId("engine-status");
  await expect(status).toBeVisible();
  await expect
    .poll(async () => (await status.textContent())?.trim() ?? "", {
      timeout: 15_000,
    })
    .not.toBe("Initialisation du moteur…");
  return (await status.textContent())?.includes("WebGPU actif") ?? false;
}

test("GPU backend dispatches compute and advances without errors", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  test.skip(!(await gpuAvailable(page)), "WebGPU unavailable");

  // Switch the compute backend to GPU (rebuilds the driver + GPU-resident mesh).
  await page.getByRole("button", { name: "GPU", exact: true }).click();
  // Exercise the LJ cell-list kernel (atomic spatial-hash bins) + the GPU thermostat kernel.
  await page.getByRole("button", { name: "L2", exact: true }).click();
  await page.getByRole("button", { name: "Berendsen", exact: true }).click();
  await page.getByRole("button", { name: /Lecture/ }).click();

  // The step counter advances — the GPU compute pipeline is dispatched each frame.
  const stepMetric = page.getByTestId("metric-step");
  await expect
    .poll(async () => Number(await stepMetric.textContent()), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  // No exceptions from the WebGPU compute dispatch or the GPU-resident render path.
  // (Pixel motion and energy readback need a real browser — see the skipped describe:
  // headless Chromium neither composites the WebGPU canvas into screenshots nor
  // resolves buffer mapAsync.)
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

// Quantitative GPU↔CPU parity via buffer readback (mapAsync) — real-browser only.
test.describe("GPU↔CPU parity (readback; non-headless only)", () => {
  test.skip(true, "WebGPU buffer readback (mapAsync) does not resolve in headless Chromium");

  test("forces match the CPU reference", async ({ page }) => {
    await page.goto("/");
    const r = await page.evaluate(() => window.__md?.forceParity());
    expect(r?.maxRel).toBeLessThan(0.02);
  });

  test("trajectory tracks the CPU reference over a few steps", async ({ page }) => {
    await page.goto("/");
    const r = await page.evaluate(() => window.__md?.stepParity(undefined, 3));
    expect(r?.maxAbs).toBeLessThan(1e-2);
  });

  test("conserves total energy under NVE", async ({ page }) => {
    await page.goto("/");
    const r = await page.evaluate(() => window.__md?.energyDrift(undefined, 1000, 50));
    expect(r?.drift).toBeLessThan(0.05);
  });

  test("runs are deterministic for a given seed", async ({ page }) => {
    await page.goto("/");
    const r = await page.evaluate(() => window.__md?.determinism(undefined, 200));
    expect(r?.identical).toBe(true);
  });

  test("FFT matches the Float64 oracle and round-trips", async ({ page }) => {
    await page.goto("/?gpu-fft=64");
    const raw = await page.getByTestId("gpu-fft-parity").textContent({ timeout: 30_000 });
    const r = JSON.parse(raw ?? "null");
    expect(r.forward.maxRel).toBeLessThan(1e-5);
    expect(r.roundTrip.maxAbs).toBeLessThan(1e-5);
  });

  test("3D FFT matches the Float64 oracle and round-trips", async ({ page }) => {
    await page.goto("/?gpu-fft3d=8x4x4");
    const raw = await page.getByTestId("gpu-fft3d-parity").textContent({ timeout: 30_000 });
    const r = JSON.parse(raw ?? "null");
    expect(r.forward.maxRel).toBeLessThan(1e-5);
    expect(r.roundTrip.maxAbs).toBeLessThan(1e-5);
  });

  test("smooth-PME reciprocal forces match the Float64 CPU oracle", async ({ page }) => {
    await page.goto("/?gpu-pme=16x16x32");
    const raw = await page.getByTestId("gpu-pme-parity").textContent({ timeout: 60_000 });
    const r = JSON.parse(raw ?? "null");
    expect(r.maxRel).toBeLessThan(5e-3);
  });
});
