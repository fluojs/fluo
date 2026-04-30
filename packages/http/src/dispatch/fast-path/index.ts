export type { FastPathEligibility, FastPathStats } from './eligibility.js';
export { FAST_PATH_ELIGIBILITY_SYMBOL, FAST_PATH_STATS_SYMBOL } from './eligibility.js';
export {
  compileFastPathEligibility,
  getHandlerFastPathEligibility,
  setHandlerFastPathEligibility,
  type FastPathExecutionResult,
} from './eligibility-checker.js';
export { executeFastPath, shouldUseFastPathForRequest } from './fast-path-executor.js';
export {
  addPathDebugHeader,
  createFastPathStats,
  createPathDebugInfo,
  formatFastPathStats,
} from './debug-visibility.js';
