/**
 * Default configuration, mirroring config/default_config.yaml exactly
 * (same keys, same default values, same units). This is the single source
 * of tunable constants for the web pipeline — nothing detection/safety
 * relevant should be a bare literal elsewhere in web/src/core.
 *
 * Values marked "starting hypothesis" carry the same caveat as the Python
 * config: they are unverified defaults pending real calibration data (see
 * docs/research_review.md and docs/CALIBRATION.md).
 */

export interface BciConfig {
  acquisition: {
    fallbackSampleRateHz: number;
    fallbackImuSampleRateHz: number;
    eegChannels: string[];
    primaryChannels: string[];
    referenceChannels: string[];
  };
  dsp: {
    highpassHz: number;
    lowpassHz: number;
    filterOrder: number;
    notchHz: number;
    notchQualityFactor: number;
    notchEnabled: boolean;
    baselineTrackerTimeConstantS: number;
  };
  spatial: {
    useAf7Af8Mean: boolean;
    useAf7Af8Difference: boolean;
    requireAf7Af8Agreement: boolean;
    af7Af8MinCorrelation: number;
    af7Af8MaxAmplitudeRatio: number;
    useReferenceChannelsForVeto: boolean;
  };
  candidateDetection: {
    windowS: number;
    thresholdMadMultiplier: number;
    minBlinkWidthS: number;
    maxBlinkWidthS: number;
    minProminenceUv: number;
    refractoryAfterCandidateS: number;
    reboundGuardS: number;
    reboundRefractoryS: number;
  };
  calibration: {
    restTrials: number;
    restTrialDurationS: number;
    singleBlinkTrials: number;
    doubleBlinkTrials: number;
    interTrialPauseS: number;
  };
  doubleBlink: {
    minIntervalS: number;
    maxIntervalS: number;
    waitForSecondTimeoutS: number;
    refractoryAfterDoubleS: number;
  };
  confidence: {
    highConfidenceThreshold: number;
    mediumConfidenceThreshold: number;
    minSignalQuality: number;
  };
  motionVeto: {
    enabled: boolean;
    accelEnergyThresholdG2: number;
    confidencePenalty: number;
  };
  communication: {
    baudRate: number;
    heartbeatIntervalS: number;
    timeoutS: number;
    commandMapping: {
      doubleBlink: string;
      singleBlink: string;
      uncertain: string;
    };
  };
  safety: {
    startupState: "HOLD";
    onUncertain: "HOLD";
    onPoorSignalQuality: "HOLD";
    onCommTimeout: "HOLD";
    onException: "HOLD";
  };
}

export function defaultConfig(): BciConfig {
  return {
    acquisition: {
      fallbackSampleRateHz: 256.0,
      fallbackImuSampleRateHz: 52.0,
      eegChannels: ["AF7", "AF8", "TP9", "TP10"],
      primaryChannels: ["AF7", "AF8"],
      referenceChannels: ["TP9", "TP10"],
    },
    dsp: {
      highpassHz: 0.5,
      lowpassHz: 20.0,
      filterOrder: 2,
      notchHz: 60.0,
      notchQualityFactor: 30.0,
      notchEnabled: true,
      baselineTrackerTimeConstantS: 4.0,
    },
    spatial: {
      useAf7Af8Mean: true,
      useAf7Af8Difference: true,
      requireAf7Af8Agreement: true,
      af7Af8MinCorrelation: 0.6,
      af7Af8MaxAmplitudeRatio: 3.0,
      useReferenceChannelsForVeto: true,
    },
    candidateDetection: {
      windowS: 1.0,
      thresholdMadMultiplier: 4.0,
      minBlinkWidthS: 0.06,
      maxBlinkWidthS: 0.4,
      minProminenceUv: 20.0,
      refractoryAfterCandidateS: 0.15,
      reboundGuardS: 0.3,
      reboundRefractoryS: 0.02,
    },
    calibration: {
      restTrials: 3,
      restTrialDurationS: 3.0,
      singleBlinkTrials: 3,
      doubleBlinkTrials: 3,
      interTrialPauseS: 1.5,
    },
    doubleBlink: {
      minIntervalS: 0.08,
      maxIntervalS: 0.6,
      waitForSecondTimeoutS: 0.7,
      refractoryAfterDoubleS: 0.5,
    },
    confidence: {
      highConfidenceThreshold: 0.8,
      mediumConfidenceThreshold: 0.55,
      minSignalQuality: 0.5,
    },
    motionVeto: {
      enabled: true,
      accelEnergyThresholdG2: 0.05,
      confidencePenalty: 0.5,
    },
    communication: {
      baudRate: 115200,
      heartbeatIntervalS: 0.5,
      timeoutS: 1.5,
      commandMapping: {
        doubleBlink: "TOGGLE_OPEN_CLOSE",
        singleBlink: "NONE",
        uncertain: "HOLD",
      },
    },
    safety: {
      startupState: "HOLD",
      onUncertain: "HOLD",
      onPoorSignalQuality: "HOLD",
      onCommTimeout: "HOLD",
      onException: "HOLD",
    },
  };
}

/** Deep-merges a partial override on top of a base config, mirroring
 * utils/config.py's _deep_merge. Used for calibration-derived overrides
 * and user-edited settings persisted to localStorage. */
export function mergeConfig(base: BciConfig, override: DeepPartial<BciConfig>): BciConfig {
  return deepMerge(base, override) as BciConfig;
}

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const overrideValue = (override as Record<string, unknown>)[key];
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(overrideValue)
      ? deepMerge(baseValue, overrideValue as DeepPartial<typeof baseValue>)
      : overrideValue;
  }
  return result as T;
}
