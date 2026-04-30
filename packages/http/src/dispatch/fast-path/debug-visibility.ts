import type { FastPathEligibility, FastPathStats } from './eligibility.js';

const DEBUG_HEADER_NAME = 'X-Fluo-Path';

interface PathDebugInfo {
  executionPath: 'fast' | 'full';
  fallbackReason?: string;
  routeId: string;
}

export function createPathDebugInfo(eligibility: FastPathEligibility): PathDebugInfo {
  return {
    executionPath: eligibility.executionPath,
    fallbackReason: eligibility.fallbackReason,
    routeId: eligibility.routeId,
  };
}

export function addPathDebugHeader(
  setHeader: (name: string, value: string) => void,
  info: PathDebugInfo,
): void {
  const value = info.executionPath === 'fast'
    ? `fast; route=${info.routeId}`
    : `full; route=${info.routeId}; reason=${info.fallbackReason ?? 'none'}`;

  setHeader(DEBUG_HEADER_NAME, value);
}

export function createFastPathStats(eligibilities: readonly FastPathEligibility[]): FastPathStats {
  const fastPathRoutes = eligibilities.filter((e) => e.executionPath === 'fast').length;

  return {
    fastPathRoutes,
    fullPathRoutes: eligibilities.length - fastPathRoutes,
    routes: eligibilities,
    totalRoutes: eligibilities.length,
  };
}

/**
 * Formats dispatcher fast-path statistics for debug logs and benchmark output.
 *
 * @param stats Fast-path statistics returned by {@link getDispatcherFastPathStats}.
 * @returns A human-readable route breakdown.
 */
export function formatFastPathStats(stats: FastPathStats): string {
  const fastPathPercent = stats.totalRoutes === 0
    ? '0.0'
    : ((stats.fastPathRoutes / stats.totalRoutes) * 100).toFixed(1);
  const fullPathPercent = stats.totalRoutes === 0
    ? '0.0'
    : ((stats.fullPathRoutes / stats.totalRoutes) * 100).toFixed(1);
  const lines: string[] = [
    '=== Fast Path Statistics ===',
    `Total routes: ${String(stats.totalRoutes)}`,
    `Fast path: ${String(stats.fastPathRoutes)} (${fastPathPercent}%)`,
    `Full path: ${String(stats.fullPathRoutes)} (${fullPathPercent}%)`,
    '',
    'Route breakdown:',
  ];

  for (const route of stats.routes) {
    const status = route.executionPath === 'fast' ? 'FAST' : 'FULL';
    const reason = route.fallbackReason ? ` (${route.fallbackReason})` : '';
    lines.push(`  [${status}] ${route.routeId}${reason}`);
  }

  return lines.join('\n');
}
