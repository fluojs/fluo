import type { InspectCommandRuntimeOptions } from './commands/inspect.js';

export type { InspectCommandRuntimeOptions } from './commands/inspect.js';

/**
 * Returns the usage information string for the inspect command through a lightweight public facade.
 *
 * @returns Formatted help text including usage and options.
 */
export function inspectUsage(): string {
  return [
    'Usage: fluo inspect <module-path> [options]',
    '',
    'Options',
    '  --json               Emit the runtime platform snapshot/diagnostics payload as JSON (default when no output mode is selected).',
    '  --mermaid            Emit a Mermaid graph through the optional @fluojs/studio rendering contract.',
    '  --timing             Include bootstrap timing diagnostics next to JSON inspect output.',
    '  --report             Emit a CI-friendly JSON report with summary, snapshot, diagnostics, and timing.',
    '  --output <path>      Write the selected inspect payload to a file instead of stdout.',
    '  --export <name>      Select the exported module symbol name (default: AppModule).',
    '  --help               Show help for the inspect command. Alias: -h.',
    '',
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

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
