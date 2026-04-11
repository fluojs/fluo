import { resolve } from 'node:path';

import { renderAliasList, renderHelpTable } from '../help.js';
import { collectBootstrapAnswers, type BootstrapPrompter } from '../new/prompt.js';
import { scaffoldBootstrapApp } from '../new/scaffold.js';
import {
  SUPPORTED_BOOTSTRAP_PLATFORMS,
  SUPPORTED_BOOTSTRAP_RUNTIMES,
  SUPPORTED_BOOTSTRAP_SHAPES,
  SUPPORTED_BOOTSTRAP_TOOLING_PRESETS,
  SUPPORTED_BOOTSTRAP_TOPOLOGY_MODES,
  SUPPORTED_BOOTSTRAP_TRANSPORTS,
} from '../new/starter-profiles.js';
import type { BootstrapAnswers, NewCommandOptions } from '../new/types.js';

type CliStream = {
  write(message: string): unknown;
};

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

/**
 * Runtime dependency overrides for the programmatic `fluo new` entry point.
 */
export interface NewCommandRuntimeOptions extends NewCommandOptions {
  cwd?: string;
  interactive?: boolean;
  prompt?: BootstrapPrompter;
  stderr?: CliStream;
  stdin?: { isTTY?: boolean };
  stdout?: CliStream;
  userAgent?: string;
}

type NewOptionHelpEntry = {
  aliases: string[];
  description: string;
  option: string;
};

const NEW_OPTION_HELP: NewOptionHelpEntry[] = [
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
    description: 'Select the transport path explicitly (http for applications, tcp for the runnable microservice starter, plus validated microservice transport families).',
    option: '--transport <http|tcp|redis|redis-streams|nats|kafka|rabbitmq|mqtt|grpc>',
  },
  {
    aliases: [],
    description: 'Select the runtime explicitly (currently only node for the HTTP starter path).',
    option: '--runtime <node>',
  },
  {
    aliases: [],
    description: 'Select the platform adapter explicitly (fastify for HTTP, none for microservices).',
    option: '--platform <fastify|none>',
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
    aliases: ['-h'],
    description: 'Show help for the new command.',
    option: '--help',
  },
];

const SUPPORTED_PACKAGE_MANAGERS = new Set<BootstrapAnswers['packageManager']>(['bun', 'npm', 'pnpm', 'yarn']);
const SUPPORTED_SHAPES = new Set<BootstrapAnswers['shape']>(SUPPORTED_BOOTSTRAP_SHAPES);
const SUPPORTED_TRANSPORTS = new Set<BootstrapAnswers['transport']>(SUPPORTED_BOOTSTRAP_TRANSPORTS);
const SUPPORTED_RUNTIMES = new Set<BootstrapAnswers['runtime']>(SUPPORTED_BOOTSTRAP_RUNTIMES);
const SUPPORTED_PLATFORMS = new Set<BootstrapAnswers['platform']>(SUPPORTED_BOOTSTRAP_PLATFORMS);
const SUPPORTED_TOOLING_PRESETS = new Set<BootstrapAnswers['tooling']>(SUPPORTED_BOOTSTRAP_TOOLING_PRESETS);
const SUPPORTED_TOPOLOGY_MODES = new Set<BootstrapAnswers['topology']['mode']>(SUPPORTED_BOOTSTRAP_TOPOLOGY_MODES);

function readOptionValue(
  argv: string[],
  index: number,
  option:
    | '--name'
    | '--package-manager'
    | '--platform'
    | '--runtime'
    | '--shape'
    | '--target-directory'
    | '--tooling'
    | '--topology'
    | '--transport',
): string {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Expected ${option} to have a value.`);
  }

  return value;
}

function setBooleanSelection(
  currentValue: boolean | undefined,
  nextValue: boolean,
  positiveFlag: string,
  negativeFlag: string,
): boolean {
  if (currentValue !== undefined) {
    throw new Error(`Duplicate ${nextValue ? positiveFlag : negativeFlag} option.`);
  }

  return nextValue;
}

function parseArgs(argv: string[]): Partial<BootstrapAnswers> & { force?: boolean } {
  const parsed: Partial<BootstrapAnswers> & { force?: boolean } = {};
  let hasExplicitTargetDirectory = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--name':
        if (parsed.projectName) {
          throw new Error('Duplicate --name option.');
        }

        parsed.projectName = readOptionValue(argv, index, '--name');
        index += 1;
        break;
      case '--package-manager':
        if (parsed.packageManager) {
          throw new Error('Duplicate --package-manager option.');
        }

        parsed.packageManager = readOptionValue(argv, index, '--package-manager') as BootstrapAnswers['packageManager'];
        if (!SUPPORTED_PACKAGE_MANAGERS.has(parsed.packageManager)) {
          throw new Error(
            `Invalid --package-manager value "${parsed.packageManager}". Use one of: pnpm, npm, yarn, bun.`,
          );
        }
        index += 1;
        break;
      case '--shape':
        if (parsed.shape) {
          throw new Error('Duplicate --shape option.');
        }

        parsed.shape = readOptionValue(argv, index, '--shape') as BootstrapAnswers['shape'];
        if (!SUPPORTED_SHAPES.has(parsed.shape)) {
          throw new Error(`Invalid --shape value "${parsed.shape}". Use one of: application, microservice, mixed.`);
        }
        index += 1;
        break;
      case '--transport':
        if (parsed.transport) {
          throw new Error('Duplicate --transport option.');
        }

        parsed.transport = readOptionValue(argv, index, '--transport') as BootstrapAnswers['transport'];
        if (!SUPPORTED_TRANSPORTS.has(parsed.transport)) {
          throw new Error(
            'Invalid --transport value "' + parsed.transport + '". Use one of: '
            + 'http, tcp, redis, redis-streams, nats, kafka, rabbitmq, mqtt, grpc.',
          );
        }
        index += 1;
        break;
      case '--runtime':
        if (parsed.runtime) {
          throw new Error('Duplicate --runtime option.');
        }

        parsed.runtime = readOptionValue(argv, index, '--runtime') as BootstrapAnswers['runtime'];
        if (!SUPPORTED_RUNTIMES.has(parsed.runtime)) {
          throw new Error(`Invalid --runtime value "${parsed.runtime}". Use: node.`);
        }
        index += 1;
        break;
      case '--platform':
        if (parsed.platform) {
          throw new Error('Duplicate --platform option.');
        }

        parsed.platform = readOptionValue(argv, index, '--platform') as BootstrapAnswers['platform'];
        if (!SUPPORTED_PLATFORMS.has(parsed.platform)) {
          throw new Error(`Invalid --platform value "${parsed.platform}". Use one of: fastify, none.`);
        }
        index += 1;
        break;
      case '--tooling':
        if (parsed.tooling) {
          throw new Error('Duplicate --tooling option.');
        }

        parsed.tooling = readOptionValue(argv, index, '--tooling') as BootstrapAnswers['tooling'];
        if (!SUPPORTED_TOOLING_PRESETS.has(parsed.tooling)) {
          throw new Error(`Invalid --tooling value "${parsed.tooling}". Use: standard.`);
        }
        index += 1;
        break;
      case '--topology': {
        const topologyMode = readOptionValue(argv, index, '--topology') as BootstrapAnswers['topology']['mode'];

        if (parsed.topology) {
          throw new Error('Duplicate --topology option.');
        }

        if (!SUPPORTED_TOPOLOGY_MODES.has(topologyMode)) {
          throw new Error(`Invalid --topology value "${topologyMode}". Use: single-package.`);
        }

        parsed.topology = {
          deferred: true,
          mode: topologyMode,
        };
        index += 1;
        break;
      }
      case '--target-directory':
        if (hasExplicitTargetDirectory) {
          throw new Error('Duplicate --target-directory option.');
        }

        parsed.targetDirectory = readOptionValue(argv, index, '--target-directory');
        hasExplicitTargetDirectory = true;
        index += 1;
        break;
      case '--force':
        parsed.force = true;
        break;
      case '--install':
        parsed.installDependencies = setBooleanSelection(
          parsed.installDependencies,
          true,
          '--install',
          '--no-install',
        );
        break;
      case '--no-install':
        parsed.installDependencies = setBooleanSelection(
          parsed.installDependencies,
          false,
          '--install',
          '--no-install',
        );
        break;
      case '--git':
        parsed.initializeGit = setBooleanSelection(parsed.initializeGit, true, '--git', '--no-git');
        break;
      case '--no-git':
        parsed.initializeGit = setBooleanSelection(parsed.initializeGit, false, '--git', '--no-git');
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option for new command: ${arg}`);
        }

        if (parsed.projectName) {
          throw new Error(`Unexpected positional argument: ${arg}`);
        }

        parsed.projectName = arg;
        if (!hasExplicitTargetDirectory) {
          parsed.targetDirectory = `./${arg}`;
        }
        break;
    }
  }

  return parsed;
}

/**
 * Renders CLI help text for `fluo new`.
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
    '  pnpm dev  # or npm run dev / yarn dev / bun run dev',
    '',
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

/**
 * Executes `fluo new` with parsed arguments and scaffold options.
 *
 * @example
 * ```ts
 * import { runNewCommand } from '@fluojs/cli';
 *
 * const exitCode = await runNewCommand(['starter-app', '--package-manager', 'pnpm'], {
 *   cwd: '/workspace',
 *   skipInstall: true,
 * });
 * ```
 *
 * @param argv Command arguments after the `new` or `create` token.
 * @param runtime Optional runtime overrides for prompt resolution, stream output, and scaffold execution.
 * @returns `0` when scaffolding succeeds, otherwise `1` after reporting the failure to `stderr`.
 */
export async function runNewCommand(argv: string[], runtime: NewCommandRuntimeOptions = {}): Promise<number> {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;

  try {
    if (argv.some(isHelpFlag)) {
      stdout.write(`${newUsage()}\n`);
      return 0;
    }

    const parsed = parseArgs(argv);

    const partialAnswers = {
      ...parsed,
      initializeGit: parsed.initializeGit ?? runtime.initializeGit,
      installDependencies: parsed.installDependencies ?? runtime.installDependencies ?? (runtime.skipInstall === true ? false : undefined),
    };

    if (!partialAnswers.projectName && !(runtime.interactive ?? runtime.prompt ?? runtime.stdin?.isTTY ?? process.stdin.isTTY)) {
      throw new Error(newUsage());
    }

    const answers = await collectBootstrapAnswers(partialAnswers, runtime.cwd ?? process.cwd(), runtime.userAgent, {
      interactive: runtime.interactive,
      prompt: runtime.prompt,
      stdin: runtime.stdin,
      stdout,
    });
    const options = {
      ...answers,
      dependencySource: runtime.dependencySource,
      force: parsed.force ?? runtime.force,
      initializeGit: answers.initializeGit,
      installDependencies: answers.installDependencies,
      repoRoot: runtime.repoRoot,
      skipInstall: runtime.skipInstall,
      targetDirectory: resolve(runtime.cwd ?? process.cwd(), answers.targetDirectory),
    };

    if (answers.installDependencies) {
      stdout.write(`Installing dependencies with ${answers.packageManager}...\n`);
    } else {
      stdout.write('Skipping dependency installation.\n');
    }

    await scaffoldBootstrapApp(options);

    stdout.write('Done.\n');
    stdout.write(
      `Next steps:\n  cd ${answers.targetDirectory}\n  ${answers.packageManager === 'npm' ? 'npm run dev' : answers.packageManager === 'bun' ? 'bun run dev' : `${answers.packageManager} dev`}\n`,
    );
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}
