export function nodeEngineRangesIntersect(
  leftRange: string | null | undefined,
  rightRange: string | null | undefined,
): boolean;

export function narrowsStableNodeEngineRange(
  previousVersion: string,
  previousRange: string | null,
  nextRange: string | null,
  nextVersion?: string,
): boolean;
