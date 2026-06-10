import type { CliRuntimeOptions } from './cli.js';
import type { InspectCommandRuntimeOptions } from './commands/inspect.js';
import type { NewCommandRuntimeOptions } from './commands/new.js';

export type { CliRuntimeOptions } from './cli.js';

/**
 * Runs the top-level CLI command dispatcher through a lazy implementation import.
 *
 * This keeps the package root embeddable for tools that only need lightweight helpers while preserving
 * the same `runCli(...)` behavior as the published `fluo` binary when callers execute it.
 *
 * @param argv Argument vector to execute. Defaults to the current process arguments inside the dispatcher.
 * @param runtime Optional runtime overrides shared by the top-level dispatcher and delegated commands.
 * @returns `0` when the command completes successfully, otherwise the delegated command exit code.
 */
export async function runCli(
  argv?: string[],
  runtime: CliRuntimeOptions & NewCommandRuntimeOptions & InspectCommandRuntimeOptions = {},
): Promise<number> {
  const { runCli: runCliImplementation } = await import('./cli.js');
  return runCliImplementation(argv, runtime);
}
