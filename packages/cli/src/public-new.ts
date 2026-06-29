import type { NewCommandRuntimeOptions } from './commands/new.js';
import { newUsage } from './usage.js';

export type { NewCommandRuntimeOptions } from './commands/new.js';
export { newUsage };

/**
 * Runs the new command through a lazy implementation import.
 *
 * @param argv Command arguments after `new` or `create`.
 * @param runtime Runtime overrides for programmatic callers.
 * @returns Process-style exit code from the new command.
 */
export async function runNewCommand(argv: string[], runtime: NewCommandRuntimeOptions = {}): Promise<number> {
  const { runNewCommand: runNewCommandImplementation } = await import('./commands/new.js');
  return runNewCommandImplementation(argv, runtime);
}
