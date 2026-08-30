import type { CacheTtlJitterMode, CacheTtlJitterOptions, NormalizedCacheTtlJitterOptions } from './types.js';

const MINIMUM_JITTERED_TTL_SECONDS = 0.001;

/**
 * Normalize opt-in TTL jitter configuration and reject ratios that cannot produce a usable spread.
 *
 * @param options Raw jitter configuration, or `undefined` when jitter stays disabled.
 * @returns Normalized jitter configuration, or `undefined` when jitter stays disabled.
 * @throws Error When `ratio` is not a finite number greater than `0` and at most `1`.
 */
export function normalizeCacheTtlJitterOptions(
  options: CacheTtlJitterOptions | undefined,
): NormalizedCacheTtlJitterOptions | undefined {
  if (!options) {
    return undefined;
  }

  if (!Number.isFinite(options.ratio) || options.ratio <= 0 || options.ratio > 1) {
    throw new Error('@fluojs/cache-manager ttlJitter.ratio must be a finite number greater than 0 and at most 1.');
  }

  const mode = options.mode ?? 'symmetric';

  if (mode !== 'symmetric' && mode !== 'shorten' && mode !== 'lengthen') {
    throw new Error("@fluojs/cache-manager ttlJitter.mode must be 'symmetric', 'shorten', or 'lengthen'.");
  }

  if (options.random !== undefined && typeof options.random !== 'function') {
    throw new Error('@fluojs/cache-manager ttlJitter.random must be a function when provided.');
  }

  return {
    mode,
    random: options.random,
    ratio: options.ratio,
  };
}

function readUnitSample(random: (() => number) | undefined): number {
  const sample = (random ?? Math.random)();

  if (!Number.isFinite(sample)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, sample));
}

function resolveJitterOffsetSeconds(
  mode: CacheTtlJitterMode,
  magnitudeSeconds: number,
  sample: number,
): number {
  switch (mode) {
    case 'symmetric':
      return magnitudeSeconds * (sample * 2 - 1);
    case 'shorten':
      return -magnitudeSeconds * sample;
    case 'lengthen':
      return magnitudeSeconds * sample;
  }
}

/**
 * Apply opt-in jitter to an already-resolved positive cache TTL.
 *
 * @param ttlSeconds Resolved TTL in seconds, taken from a per-call override or the module default.
 * @param jitter Normalized jitter configuration, or `undefined` when jitter stays disabled.
 * @returns The TTL handed to the cache store, preserving `0` as a no-expiry write and never returning a non-positive expiring TTL.
 */
export function applyCacheTtlJitter(
  ttlSeconds: number,
  jitter: NormalizedCacheTtlJitterOptions | undefined,
): number {
  if (!jitter || ttlSeconds <= 0) {
    return ttlSeconds;
  }

  const offsetSeconds = resolveJitterOffsetSeconds(
    jitter.mode,
    ttlSeconds * jitter.ratio,
    readUnitSample(jitter.random),
  );

  return Math.max(MINIMUM_JITTERED_TTL_SECONDS, ttlSeconds + offsetSeconds);
}
