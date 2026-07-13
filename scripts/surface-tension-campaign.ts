import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  campaignCsv,
  parseCampaignArgs,
  runSurfaceTensionCampaign,
} from "../src/cli/surfaceTensionCampaign";

const options = parseCampaignArgs(process.argv.slice(2));
const records = runSurfaceTensionCampaign(options);
const jsonPath = resolve(options.output);
const csvPath = jsonPath.replace(/\.json$/i, ".csv");
mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(
  jsonPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), options, records }, null, 2)}\n`,
);
writeFileSync(csvPath, campaignCsv(records));
console.log(`JSON: ${jsonPath}`);
console.log(`CSV:  ${csvPath}`);
