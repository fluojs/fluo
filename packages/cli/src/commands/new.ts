import { resolve } from 'node:path';

import { log as clackLog, spinner as clackSpinner } from '@clack/prompts';

import { installDependencies } from '../new/install.js';
import { type BootstrapPrompter, collectBootstrapAnswers } from '../new/prompt.js';
import { resolveBootstrapPlan } from '../new/resolver.js';
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
import { isCliPromptCancelledError } from '../prompt-cancel.js';
import { newUsage } from '../usage.js';

type CliStream = {
  write(message: string): unknown;
};

function shouldUseInteractiveShell(runtime: NewCommandRuntimeOptions): boolean {
  return runtime.prompt === undefined
    && runtime.stdout === undefined
    && runtime.stderr === undefined
    && (runtime.interactive ?? true)
    && Boolean(runtime.stdin?.isTTY ?? process.stdin.isTTY);
}

function extractDependencyInstallationOutput(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('output' in error)) {
    return undefined;
  }

  const output = error.output;
  return typeof output === 'string' && output.trim().length > 0 ? output : undefined;
}

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

function parseArgs(argv: string[]): Partial<BootstrapAnswers> & { force?: boolean; printPlan?: boolean } {
  const parsed: Partial<BootstrapAnswers> & { force?: boolean; printPlan?: boolean } = {};
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
            + 'http, tcp, redis-streams, nats, kafka, rabbitmq, mqtt, grpc.',
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
          throw new Error(`Invalid --runtime value "${parsed.runtime}". Use one of: bun, cloudflare-workers, deno, node.`);
        }
        index += 1;
        break;
      case '--platform':
        if (parsed.platform) {
          throw new Error('Duplicate --platform option.');
        }

        parsed.platform = readOptionValue(argv, index, '--platform') as BootstrapAnswers['platform'];
        if (!SUPPORTED_PLATFORMS.has(parsed.platform)) {
          throw new Error(`Invalid --platform value "${parsed.platform}". Use one of: bun, cloudflare-workers, deno, fastify, express, nodejs, none.`);
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
      case '--print-plan':
        parsed.printPlan = true;
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

function renderDependencyList(dependencies: readonly string[]): string {
  return dependencies.length > 0 ? dependencies.join(', ') : '(none)';
}

function renderScaffoldPlanPreview(answers: BootstrapAnswers, resolvedTargetDirectory: string): string {
  const bootstrapPlan = resolveBootstrapPlan(answers);

  return [
    'fluo new scaffold plan',
    '',
    `Project name: ${answers.projectName}`,
    `Target directory: ${answers.targetDirectory}`,
    `Resolved target: ${resolvedTargetDirectory}`,
    `Shape: ${answers.shape}`,
    `Runtime: ${answers.runtime}`,
    `Platform: ${answers.platform}`,
    `Transport: ${answers.transport}`,
    `Tooling preset: ${answers.tooling}`,
    `Topology: ${answers.topology.mode}${answers.topology.deferred ? ' (deferred)' : ''}`,
    `Starter recipe: ${bootstrapPlan.profile.id}`,
    `Emitter: ${bootstrapPlan.emitter.type}`,
    `Package manager: ${answers.packageManager}`,
    `Install dependencies: ${answers.installDependencies ? 'yes' : 'no'}`,
    `Initialize git: ${answers.initializeGit ? 'yes' : 'no'}`,
    '',
    'Dependencies:',
    `  runtime: ${renderDependencyList(bootstrapPlan.dependencies.dependencies)}`,
    `  dev: ${renderDependencyList(bootstrapPlan.dependencies.devDependencies)}`,
    '',
    'Side effects: none. Preview mode does not create files, install dependencies, or initialize git.',
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
      completionMessage: parsed.printPlan ? 'Scaffold plan resolved. No files were written.' : undefined,
      prompt: runtime.prompt,
      stdin: runtime.stdin,
      stdout,
    });
    const targetDirectory = resolve(runtime.cwd ?? process.cwd(), answers.targetDirectory);

    if (parsed.printPlan) {
      stdout.write(`${renderScaffoldPlanPreview(answers, targetDirectory)}\n`);
      return 0;
    }

    const options = {
      ...answers,
      dependencySource: runtime.dependencySource,
      force: parsed.force ?? runtime.force,
      initializeGit: answers.initializeGit,
      installDependencies: false,
      repoRoot: runtime.repoRoot,
      skipInstall: true,
      targetDirectory,
    };

    const isInteractiveShell = shouldUseInteractiveShell(runtime);
    let scaffoldSpinner: ReturnType<typeof clackSpinner> | undefined;

    if (!answers.installDependencies && !isInteractiveShell) {
      stdout.write('Skipping dependency installation.\n');
    }

    if (isInteractiveShell) {
      scaffoldSpinner = clackSpinner();
      scaffoldSpinner.start('Scaffolding project files');
    }

    await scaffoldBootstrapApp(options);

    if (scaffoldSpinner) {
      scaffoldSpinner.stop('Project files written');
    }

    if (answers.installDependencies) {
      if (!isInteractiveShell) {
        stdout.write(`Installing dependencies with ${answers.packageManager}...\n`);
        await installDependencies(targetDirectory, answers.packageManager, { stderr });
      } else {
        const installSpinner = clackSpinner();
        installSpinner.start(`Installing dependencies with ${answers.packageManager}`);

        try {
          await installDependencies(targetDirectory, answers.packageManager, {
            stderr,
            stdio: 'capture',
          });
          installSpinner.stop('Dependencies installed');
        } catch (error: unknown) {
          installSpinner.error('Dependency installation failed');

          const output = extractDependencyInstallationOutput(error);
          if (output) {
            stderr.write(`\n[fluo] Full installation log:\n${output}${output.endsWith('\n') ? '' : '\n'}`);
          }

          throw error;
        }
      }
    } else if (isInteractiveShell) {
      clackLog.step('Dependency installation skipped');
    }

    stdout.write('Done.\n');
    stdout.write(
      `Next steps:\n  cd ${answers.targetDirectory}\n  ${answers.packageManager === 'npm' ? 'npm run dev' : answers.packageManager === 'bun' ? 'bun run dev' : `${answers.packageManager} dev`}  # runs fluo dev\n`,
    );
    return 0;
  } catch (error: unknown) {
    if (isCliPromptCancelledError(error)) {
      return 0;
    }

    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}
