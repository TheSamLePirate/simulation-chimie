import { describe, expect, it } from "vitest";
import { campaignCsv, parseCampaignArgs } from "./surfaceTensionCampaign";

describe("surface-tension campaign CLI", () => {
  it("exposes scientific defaults and a bounded quick protocol", () => {
    const production = parseCampaignArgs([]);
    expect(production.temperaturesK).toEqual([280, 300, 320, 340]);
    expect(production.replicas).toBe(5);
    expect(production.equilibrationPs).toBe(200);
    expect(production.productionPs).toBe(2000);
    const quick = parseCampaignArgs(["--quick", "--out=tmp/result.json"]);
    expect(quick.moleculeCounts).toEqual([8]);
    expect(quick.replicas).toBe(1);
    expect(quick.output).toBe("tmp/result.json");
  });

  it("serializes records with stable headers", () => {
    const csv = campaignCsv([
      {
        temperatureK: 300,
        molecules: 1024,
        replica: 0,
        seed: 7,
        samples: 10,
        gammaTestAreaMilliNewtonPerMeter: 70,
        gammaTestAreaSemMilliNewtonPerMeter: 1,
        gammaMechanicalMilliNewtonPerMeter: 71,
        gammaMechanicalSemMilliNewtonPerMeter: 2,
        routeDifferenceMilliNewtonPerMeter: 1,
        iapwsMilliNewtonPerMeter: 71.69,
        finalTemperatureK: 300.5,
        elapsedPs: 2200,
      },
    ]);
    expect(csv).toContain("temperatureK,molecules,replica");
    expect(csv).toContain("300,1024,0,7,10");
  });
});
