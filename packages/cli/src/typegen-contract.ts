/** Stable process exit codes returned by `fluo typegen`. */
export const TYPEGEN_EXIT_CODES = {
  ERROR: 1,
  MALFORMED: 4,
  MISSING: 2,
  STALE: 3,
  SUCCESS: 0,
  UNSUPPORTED_VERSION: 5,
} as const;
