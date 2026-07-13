import {
  REFERENCE_SURFACE_TENSION_CONFIG,
  SurfaceTensionExperiment,
} from "../core/experiments/surfaceTension";
import { iapwsSurfaceTension } from "../core/observables/referenceSurfaceTension";
import { blockAverage, surfaceTensionToMilliNewtonPerMeter } from "../core/observables/tensor";

export interface CampaignOptions {
  readonly temperaturesK: readonly number[];
  readonly moleculeCounts: readonly number[];
  readonly replicas: number;
  readonly equilibrationPs: number;
  readonly productionPs: number;
  readonly sampleEveryPs: number;
  readonly blockDurationPs: number;
  readonly relativeAreaStep: number;
  readonly strain: number;
  readonly baseSeed: number;
  readonly output: string;
  readonly quick: boolean;
}

export interface CampaignRecord {
  readonly temperatureK: number;
  readonly molecules: number;
  readonly replica: number;
  readonly seed: number;
  readonly samples: number;
  readonly gammaTestAreaMilliNewtonPerMeter: number;
  readonly gammaTestAreaSemMilliNewtonPerMeter: number;
  readonly gammaMechanicalMilliNewtonPerMeter: number;
  readonly gammaMechanicalSemMilliNewtonPerMeter: number;
  readonly routeDifferenceMilliNewtonPerMeter: number;
  readonly iapwsMilliNewtonPerMeter: number;
  readonly finalTemperatureK: number;
  readonly elapsedPs: number;
}

const DEFAULT_OPTIONS: CampaignOptions = {
  temperaturesK: [280, 300, 320, 340],
  moleculeCounts: [1024],
  replicas: 5,
  equilibrationPs: 200,
  productionPs: 2000,
  sampleEveryPs: 2,
  blockDurationPs: 100,
  relativeAreaStep: 5e-4,
  strain: 2e-5,
  baseSeed: 20250713,
  output: "results/surface-tension-campaign.json",
  quick: false,
};

function numberList(value: string, name: string): number[] {
  const values = value.split(",").map(Number);
  if (values.length === 0 || values.some((item) => !Number.isFinite(item) || item <= 0)) {
    throw new RangeError(`${name} must be a comma-separated list of positive numbers`);
  }
  return values;
}

export function parseCampaignArgs(args: readonly string[]): CampaignOptions {
  const values = new Map<string, string>();
  let quick = false;
  for (const argument of args) {
    if (argument === "--quick") {
      quick = true;
      continue;
    }
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    if (!match) throw new Error(`Unknown argument: ${argument}`);
    values.set(match[1], match[2]);
  }
  const numeric = (key: string, fallback: number) => {
    const value = values.has(key) ? Number(values.get(key)) : fallback;
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${key} must be positive`);
    return value;
  };
  const base = quick
    ? {
        ...DEFAULT_OPTIONS,
        temperaturesK: [300],
        moleculeCounts: [8],
        replicas: 1,
        equilibrationPs: 0.002,
        productionPs: 0.004,
        sampleEveryPs: 0.002,
        blockDurationPs: 0.002,
        output: "results/surface-tension-quick.json",
        quick: true,
      }
    : DEFAULT_OPTIONS;
  const options: CampaignOptions = {
    temperaturesK: values.has("temperatures")
      ? numberList(values.get("temperatures") ?? "", "temperatures")
      : base.temperaturesK,
    moleculeCounts: values.has("molecules")
      ? numberList(values.get("molecules") ?? "", "molecules").map((value) => Math.round(value))
      : base.moleculeCounts,
    replicas: Math.round(numeric("replicas", base.replicas)),
    equilibrationPs: numeric("equilibration-ps", base.equilibrationPs),
    productionPs: numeric("production-ps", base.productionPs),
    sampleEveryPs: numeric("sample-every-ps", base.sampleEveryPs),
    blockDurationPs: numeric("block-ps", base.blockDurationPs),
    relativeAreaStep: numeric("area-step", base.relativeAreaStep),
    strain: numeric("strain", base.strain),
    baseSeed: Math.round(numeric("seed", base.baseSeed)),
    output: values.get("out") ?? base.output,
    quick,
  };
  if (options.sampleEveryPs > options.productionPs) {
    throw new RangeError("sample-every-ps cannot exceed production-ps");
  }
  return options;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}

function experimentFor(
  options: CampaignOptions,
  molecules: number,
  temperatureK: number,
  seed: number,
) {
  const lateral = Math.max(options.quick ? 1.2 : 0, 3.2 * Math.sqrt(molecules / 1024));
  const lz = molecules >= 1024 ? 10 : 8;
  const spacing = options.quick ? 0.14 : 0.05;
  return new SurfaceTensionExperiment({
    ...REFERENCE_SURFACE_TENSION_CONFIG,
    molecules,
    box: [lateral, lateral, lz],
    temperatureK,
    seed,
    pmeGrid: [
      nextPowerOfTwo(Math.max(options.quick ? 8 : 32, Math.ceil(lateral / spacing))),
      nextPowerOfTwo(Math.max(options.quick ? 8 : 32, Math.ceil(lateral / spacing))),
      nextPowerOfTwo(Math.max(options.quick ? 16 : 64, Math.ceil(lz / spacing))),
    ],
    densityBins: options.quick ? 20 : 100,
  });
}

function stepCount(durationPs: number, timestepPs: number): number {
  return Math.round(durationPs / timestepPs);
}

export function campaignCsv(records: readonly CampaignRecord[]): string {
  const keys = Object.keys(records[0] ?? {}) as Array<keyof CampaignRecord>;
  if (keys.length === 0) return "";
  return `${keys.join(",")}\n${records.map((record) => keys.map((key) => record[key]).join(",")).join("\n")}\n`;
}

export function runSurfaceTensionCampaign(options: CampaignOptions): CampaignRecord[] {
  const records: CampaignRecord[] = [];
  const totalRuns = options.temperaturesK.length * options.moleculeCounts.length * options.replicas;
  let completed = 0;
  for (const molecules of options.moleculeCounts) {
    for (const temperatureK of options.temperaturesK) {
      for (let replica = 0; replica < options.replicas; replica++) {
        const seed =
          options.baseSeed + 104729 * replica + 1009 * molecules + Math.round(temperatureK);
        const experiment = experimentFor(options, molecules, temperatureK, seed);
        const dt = experiment.config.timestepPs;
        experiment.step(stepCount(options.equilibrationPs, dt));
        const sampleStride = stepCount(options.sampleEveryPs, dt);
        const samples = Math.floor(options.productionPs / options.sampleEveryPs);
        for (let sample = 0; sample < samples; sample++) {
          experiment.step(sampleStride);
          experiment.collectSurfaceTensionSample(options.relativeAreaStep, options.strain);
        }
        const blockSamples = Math.max(
          1,
          Math.round(options.blockDurationPs / options.sampleEveryPs),
        );
        const testArea = experiment.testAreaEstimate(options.relativeAreaStep, blockSamples);
        const mechanical = blockAverage(experiment.mechanicalGammaSamples, blockSamples);
        const gammaTest = surfaceTensionToMilliNewtonPerMeter(testArea.gamma);
        const gammaMechanical = surfaceTensionToMilliNewtonPerMeter(mechanical.mean);
        const instantaneous = experiment.instantaneous();
        records.push({
          temperatureK,
          molecules,
          replica,
          seed,
          samples,
          gammaTestAreaMilliNewtonPerMeter: gammaTest,
          gammaTestAreaSemMilliNewtonPerMeter: surfaceTensionToMilliNewtonPerMeter(
            testArea.blockStatistics.standardError,
          ),
          gammaMechanicalMilliNewtonPerMeter: gammaMechanical,
          gammaMechanicalSemMilliNewtonPerMeter: surfaceTensionToMilliNewtonPerMeter(
            mechanical.standardError,
          ),
          routeDifferenceMilliNewtonPerMeter: gammaMechanical - gammaTest,
          iapwsMilliNewtonPerMeter: iapwsSurfaceTension(temperatureK),
          finalTemperatureK: instantaneous.temperatureK,
          elapsedPs: instantaneous.timePs,
        });
        completed++;
        console.log(
          `[${completed}/${totalRuns}] N=${molecules} T=${temperatureK} K replica=${replica + 1} γ=${gammaTest.toFixed(3)} mN/m`,
        );
      }
    }
  }
  return records;
}
