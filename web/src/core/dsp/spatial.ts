/**
 * Spatial (multi-channel) combination logic — port of dsp/spatial.py.
 * We never threshold a single EEG channel in isolation.
 */

export function frontalMean(af7: number, af8: number): number {
  return (af7 + af8) / 2;
}

export function frontalDifference(af7: number, af8: number): number {
  return af7 - af8;
}

export interface AgreementResult {
  correlation: number;
  amplitudeRatio: number;
  agrees: boolean;
}

function mean(arr: Float64Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function std(arr: Float64Array | number[], m: number): number {
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / arr.length);
}

function pearsonCorrelation(a: Float64Array | number[], b: Float64Array | number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-18) return 0;
  return cov / denom;
}

/**
 * Checks whether an AF7/AF8 candidate window looks like a genuine bilateral
 * ocular event rather than single-electrode noise / localized artifact.
 */
export function checkAf7Af8Agreement(
  af7Window: Float64Array | number[],
  af8Window: Float64Array | number[],
  minCorrelation = 0.6,
  maxAmplitudeRatio = 3.0,
): AgreementResult {
  if (af7Window.length < 2 || af8Window.length < 2) {
    return { correlation: 0, amplitudeRatio: Infinity, agrees: false };
  }

  const m7 = mean(af7Window);
  const m8 = mean(af8Window);
  const s7 = std(af7Window, m7);
  const s8 = std(af8Window, m8);

  let correlation: number;
  if (s7 < 1e-9 || s8 < 1e-9) {
    correlation = 0;
  } else {
    correlation = pearsonCorrelation(af7Window, af8Window);
    if (Number.isNaN(correlation)) correlation = 0;
  }

  let amp7 = 0;
  let amp8 = 0;
  for (let i = 0; i < af7Window.length; i++) amp7 = Math.max(amp7, Math.abs(af7Window[i]));
  for (let i = 0; i < af8Window.length; i++) amp8 = Math.max(amp8, Math.abs(af8Window[i]));
  const lo = Math.min(amp7, amp8);
  const hi = Math.max(amp7, amp8);
  const amplitudeRatio = lo > 1e-9 ? hi / lo : Infinity;

  const agrees = correlation >= minCorrelation && amplitudeRatio <= maxAmplitudeRatio;
  return { correlation, amplitudeRatio, agrees };
}
