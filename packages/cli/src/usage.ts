import { renderAliasList, renderHelpTable } from './help.js';

type CommandOptionHelpEntry = {
  aliases: string[];
  description: string;
  option: string;
};

const NEW_OPTION_HELP: CommandOptionHelpEntry[] = [
  {
    aliases: [],
    description: 'Provide the project name without using the positional argument.',
    option: '--name <project-name>',
  },
  {
    aliases: [],
    description: 'Select the scaffold shape explicitly (application for HTTP, microservice for the transport-driven starter path, mixed for the API + microservice starter).',
    option: '--shape <application|microservice|mixed>',
  },
  {
    aliases: [],
    description: 'Select the transport path explicitly (http for applications, tcp for the runnable microservice starter, plus shipped microservice starter transports).',
    option: '--transport <http|tcp|redis-streams|nats|kafka|rabbitmq|mqtt|grpc>',
  },
  {
    aliases: [],
    description: 'Select the runtime explicitly (node, bun, deno, or cloudflare-workers for application starters; node for microservice and mixed starters).',
    option: '--runtime <node|bun|deno|cloudflare-workers>',
  },
  {
    aliases: [],
    description: 'Select the platform adapter explicitly (fastify, express, or nodejs on node; bun/deno/cloudflare-workers on their native runtimes; none for microservices).',
    option: '--platform <fastify|express|nodejs|bun|deno|cloudflare-workers|none>',
  },
  {
    aliases: [],
    description: 'Select the starter tooling preset explicitly (currently only standard).',
    option: '--tooling <standard>',
  },
  {
    aliases: [],
    description: 'Select the starter topology mode explicitly (currently only single-package).',
    option: '--topology <single-package>',
  },
  {
    aliases: [],
    description: 'Choose which package manager installs the starter dependencies.',
    option: '--package-manager <pnpm|npm|yarn|bun>',
  },
  {
    aliases: [],
    description: 'Write the new app to a custom target directory (always overrides positional name path).',
    option: '--target-directory <path>',
  },
  {
    aliases: [],
    description: 'Overwrite files in a non-empty target directory without prompting.',
    option: '--force',
  },
  {
    aliases: [],
    description: 'Install starter dependencies after writing files.',
    option: '--install',
  },
  {
    aliases: [],
    description: 'Skip starter dependency installation.',
    option: '--no-install',
  },
  {
    aliases: [],
    description: 'Initialize a git repository in the generated starter.',
    option: '--git',
  },
  {
    aliases: [],
    description: 'Skip git repository initialization in the generated starter.',
    option: '--no-git',
  },
  {
    aliases: [],
    description: 'Print the resolved scaffold plan without writing files, installing dependencies, or initializing git.',
    option: '--print-plan',
  },
  {
    aliases: ['-h'],
    description: 'Show help for the new command.',
    option: '--help',
  },
];

const INSPECT_OPTION_HELP: CommandOptionHelpEntry[] = [
  {
    aliases: [],
    description: 'Emit the runtime platform snapshot/diagnostics payload as JSON (default when no output mode is selected).',
    option: '--json',
  },
  {
    aliases: [],
    description: 'Emit a Mermaid graph through the optional @fluojs/studio rendering contract.',
    option: '--mermaid',
  },
  {
    aliases: [],
    description: 'Include bootstrap timing diagnostics next to JSON inspect output.',
    option: '--timing',
  },
  {
    aliases: [],
    description: 'Emit a CI-friendly JSON report with summary, snapshot, diagnostics, and timing.',
    option: '--report',
  },
  {
    aliases: [],
    description: 'Write the selected inspect payload to a file instead of stdout.',
    option: '--output <path>',
  },
  {
    aliases: [],
    description: 'Select the exported module symbol name (default: AppModule).',
    option: '--export <name>',
  },
  {
    aliases: ['-h'],
    description: 'Show help for the inspect command.',
    option: '--help',
  },
];

/**
 * Renders CLI help text for `fluo new` without importing the scaffold implementation.
 *
 * @returns Stable help output for the scaffolding command.
 */
export function newUsage(): string {
  return [
    'Usage: fluo new|create [project-name] [options]',
    '',
    'Options',
    renderHelpTable(NEW_OPTION_HELP, [
      {
        header: 'Option',
        render: (entry) => entry.option,
      },
      {
        header: 'Aliases',
        render: (entry) => renderAliasList(entry.aliases),
      },
      {
        header: 'Description',
        render: (entry) => entry.description,
      },
    ]),
    '',
    'Next steps:',
    '  cd <app-name>',
    '  pnpm dev  # runs fluo dev from the generated package.json script',
    '',
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

/**
 * Returns the usage information string for the inspect command without importing runtime inspection logic.
 *
 * @returns Formatted help text including usage and options.
 */
export function inspectUsage(): string {
  return [
    'Usage: fluo inspect <module-path> [options]',
    '',
    'Options',
    renderHelpTable(INSPECT_OPTION_HELP, [
      { header: 'Option', render: (entry) => entry.option },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}
