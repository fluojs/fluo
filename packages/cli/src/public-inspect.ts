import type { InspectCommandRuntimeOptions } from './commands/inspect.js';
import { inspectUsage } from './usage.js';

export type { InspectCommandRuntimeOptions } from './commands/inspect.js';
export { inspectUsage };

/**
 * Runs the inspect command through a lazy implementation import.
 *
 * @param argv Command arguments after `inspect`.
 * @param runtime Runtime overrides for programmatic callers.
 * @returns Process-style exit code from the inspect command.
 */
export async function runInspectCommand(argv: string[], runtime: InspectCommandRuntimeOptions = {}): Promise<number> {
  const { runInspectCommand: runInspectCommandImplementation } = await import('./commands/inspect.js');
  return runInspectCommandImplementation(argv, runtime);
}
