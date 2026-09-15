import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CausalBlinkBandFilter } from "./filters";

interface FilterGoldenVector {
  input: number[];
  expectedOutput: number[];
  toleranceUv: number;
}

function loadFixture<T>(name: string): T {
  const path = join(__dirname, "..", "__fixtures__", name);
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

describe("CausalBlinkBandFilter vs Python golden vector", () => {
  it("matches src/bcihand/dsp/filters.py's CausalBlinkBandFilter within tolerance", () => {
    const fixture = loadFixture<FilterGoldenVector>("filterGoldenVector.json");
    const filter = new CausalBlinkBandFilter(256.0, 4.0, true);

    let maxAbsDiff = 0;
    for (let i = 0; i < fixture.input.length; i++) {
      const y = filter.processSample(fixture.input[i]);
      const diff = Math.abs(y - fixture.expectedOutput[i]);
      if (diff > maxAbsDiff) maxAbsDiff = diff;
    }

    expect(maxAbsDiff).toBeLessThanOrEqual(fixture.toleranceUv);
  });
});
