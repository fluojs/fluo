import type { NewCommandRuntimeOptions } from './commands/new.js';

export type { NewCommandRuntimeOptions } from './commands/new.js';

/**
 * Returns the usage information string for the new command through a lightweight public facade.
 *
 * @returns Formatted help text including usage and options.
 */
export function newUsage(): string {
  return [
    'Usage: fluo new|create [project-name] [options]',
    '',
    'Options',
    '  --name <project-name>                 Provide the project name without using the positional argument.',
    '  --shape <application|microservice|mixed>',
    '  --transport <http|tcp|redis-streams|nats|kafka|rabbitmq|mqtt|grpc>',
    '  --runtime <node|bun|deno|cloudflare-workers>',
    '  --platform <fastify|express|nodejs|bun|deno|cloudflare-workers|none>',
    '  --tooling <standard>',
    '  --topology <single-package>',
    '  --package-manager <pnpm|npm|yarn|bun>',
    '  --target-directory <path>',
    '  --force',
    '  --install / --no-install',
    '  --git / --no-git',
    '  --print-plan',
    '  --help                                 Show help for the new command. Alias: -h.',
    '',
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

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
