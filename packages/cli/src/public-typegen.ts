import type { TypegenCommandRuntimeOptions } from './commands/typegen.js';
import { typegenUsage } from './usage.js';

export type { TypegenCommandRuntimeOptions } from './commands/typegen.js';
export { typegenUsage };

/**
 * Runs React page type generation through a lazy implementation import.
 *
 * @param argv Command arguments after `typegen`.
 * @param runtime Runtime overrides for programmatic callers.
 * @returns Process-style exit code from the typegen command.
 */
export async function runTypegenCommand(
  argv: readonly string[],
  runtime: TypegenCommandRuntimeOptions = {},
): Promise<number> {
  const { runTypegenCommand: runTypegenCommandImplementation } = await import('./commands/typegen.js');
  return runTypegenCommandImplementation(argv, runtime);
}
