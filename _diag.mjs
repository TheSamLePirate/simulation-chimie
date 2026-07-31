import { chromium, devices } from "@playwright/test";

const b = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
});
const ctx = await b.newContext({ ...devices["Desktop Chrome"] });
const p = await ctx.newPage();
await p.goto("http://localhost:4173/", { waitUntil: "load" });

async function probe(label) {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    try {
      await p.getByTestId("engine-status").textContent({ timeout: 4000 });
      times.push(Date.now() - t);
    } catch {
      times.push(-1);
    }
    await p.waitForTimeout(400);
  }
  console.log(label.padEnd(28), times.join(", "));
}

await p.waitForTimeout(2500);
await probe("baseline (all on)");
await p.evaluate(() => document.querySelector(".instruments")?.remove());
await probe("without .instruments");
await p.evaluate(() => document.querySelector(".metrics")?.remove());
await probe("+ metrics removed");
await p.evaluate(() => document.querySelector(".atmos")?.remove());
await probe("+ atmos removed");
await b.close();
