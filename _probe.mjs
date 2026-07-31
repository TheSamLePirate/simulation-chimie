import { chromium } from "@playwright/test";

const b = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu"] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
let step = "load";
p.on("console", async (m) => {
  if (m.type() !== "error") return;
  console.log(`\n### at step "${step}":`, m.text().slice(0, 300));
  for (const a of m.args().slice(0, 3)) {
    try {
      const v = await a.jsonValue();
      if (typeof v === "string" && v.length > 40) console.log("ARG:", v.slice(0, 1200));
    } catch {}
  }
  console.log("LOC:", JSON.stringify(m.location()));
});
await p.goto("http://localhost:5199/", { waitUntil: "load" });
await p.waitForTimeout(3500);
step = "play";
await p.getByRole("button", { name: /Lecture/ }).click();
await p.waitForTimeout(2500);
step = "instruments";
await p.getByText("Instruments", { exact: true }).click();
await p.waitForTimeout(2500);
step = "close-instruments";
await p.getByText("Instruments", { exact: true }).click();
await p.waitForTimeout(1000);
step = "settings";
await p.getByRole("tab", { name: "Réglages" }).click();
await p.waitForTimeout(800);
step = "scenes";
await p.getByRole("tab", { name: "Scènes" }).click();
await p.waitForTimeout(500);
step = "droplet";
await p.getByRole("button", { name: /Tension de surface \(gouttelette\)/ }).click();
await p.waitForTimeout(5000);
step = "lab";
await p.getByRole("button", { name: /Laboratoire γ\(T\)/ }).click();
await p.waitForTimeout(5000);
step = "narrow";
await p.setViewportSize({ width: 760, height: 900 });
await p.waitForTimeout(2500);
step = "narrow-scenes";
await p.getByRole("tab", { name: "Scènes" }).click();
await p.waitForTimeout(800);
step = "narrow-gas";
await p.getByRole("button", { name: /Gaz parfait/ }).click();
await p.waitForTimeout(4000);
console.log("done");
await b.close();
