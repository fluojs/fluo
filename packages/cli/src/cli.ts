import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { InspectCommandRuntimeOptions } from './commands/inspect.js';
import type { NewCommandRuntimeOptions } from './commands/new.js';
import type { TypegenCommandRuntimeOptions } from './commands/typegen.js';
import type { DevRunnerRuntime } from './dev-runner/node-restart-runner.js';
import { renderAliasList, renderHelpTable } from './help.js';
import type { startStudioSidecar } from './studio/sidecar.js';
import type { GenerateOptions, GeneratorKind } from './types.js';
import { type CliUpdateCheckRuntimeOptions, removeUpdateCheckFlags, runCliUpdateCheck } from './update-check.js';
import { inspectUsage, newUsage, typegenUsage } from './usage.js';

type CliStream = {
  isTTY?: boolean;
  write(message: string): unknown;
};

type CliReadableStream = {
  isTTY?: boolean;
};

/**
 * Runtime dependency overrides for embedding the CLI in tests or higher-level tooling.
 */
export interface CliRuntimeOptions {
  ci?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchDistTags?: (packageName: string) => Promise<Record<string, string> | undefined>;
  spawnCommand?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stderr?: CliStream; stdio: 'inherit' | 'pipe'; stdout?: CliStream }) => Promise<number>;
  startStudioSidecar?: typeof startStudioSidecar;
  stderr?: CliStream;
  stdin?: CliReadableStream;
  stdout?: CliStream;
  updateCheck?: false | CliUpdateCheckRuntimeOptions;
}

type ParsedCliArgs = {
  kind: GeneratorKind;
  name: string;
  options: GenerateOptions;
  targetDirectory?: string;
};

type ParsedCommand =
  | {
      argv: string[];
      command: 'add';
    }
  | {
      argv: string[];
      command: 'analyze';
    }
  | {
      argv: string[];
      command: 'doctor';
    }
  | {
      argv: string[];
      command: 'info';
    }
  | {
      argv: string[];
      command: 'build' | 'dev' | 'start';
    }
  | {
      argv: string[];
      command: 'upgrade';
    }
  | {
      argv: string[];
      command: 'new';
    }
  | {
      argv: string[];
      command: 'migrate';
    }
  | {
      argv: string[];
      command: 'inspect';
    }
  | {
      argv: string[];
      command: 'typegen';
    }
  | {
      argv: string[];
      command: 'generate';
      parsed: ParsedCliArgs;
    };

type GenerateKindHelpEntry = {
  aliases: string[];
  description: string;
  kind: GeneratorKind;
  schematic: string;
  wiring: string;
};

type GenerateOptionHelpEntry = {
  aliases: string[];
  description: string;
  option: string;
};

type TopLevelCommandHelpEntry = {
  aliases: string[];
  command: string;
  description: string;
};

const TOP_LEVEL_COMMAND_HELP: TopLevelCommandHelpEntry[] = [
  { aliases: ['create'], command: 'new', description: 'Scaffold a new fluo application and install dependencies.' },
  { aliases: ['g'], command: 'generate', description: 'Generate a schematic inside an existing fluo application.' },
  { aliases: ['info'], command: 'doctor', description: 'Print CLI, registry, update-cache, runtime, and project diagnostics.' },
  { aliases: [], command: 'analyze', description: 'Summarize project diagnostics and point to deeper inspection flows.' },
  { aliases: [], command: 'dev', description: 'Run the generated project development lifecycle.' },
  { aliases: [], command: 'start', description: 'Run the generated project production lifecycle.' },
  { aliases: [], command: 'build', description: 'Run the generated project build lifecycle.' },
  { aliases: [], command: 'add', description: 'Install @fluojs packages with the detected package manager.' },
  { aliases: [], command: 'upgrade', description: 'Report latest CLI state and migration workflow guidance.' },
  { aliases: [], command: 'inspect', description: 'Inspect runtime platform snapshot/diagnostics and emit timing optionally.' },
  { aliases: [], command: 'typegen', description: 'Generate, check, or watch path-only React page route types.' },
  { aliases: [], command: 'migrate', description: 'Run NestJS-to-fluo codemods (dry-run by default).' },
  { aliases: ['--version', '-v'], command: 'version', description: 'Print the installed fluo CLI version.' },
  { aliases: [], command: 'help', description: 'Show top-level or command-specific help.' },
];

const NODE_DEV_RUNNER_COMMAND = '__node-dev-runner';
const DEV_RUNNER_COMMAND = '__dev-runner';

function parseDevRunnerRuntime(value: string | undefined): DevRunnerRuntime {
  if (value === 'bun' || value === 'cloudflare-workers' || value === 'deno' || value === 'node') {
    return value;
  }

  throw new Error(`Invalid dev runner runtime "${value ?? ''}".`);
}

function parseDevRunnerInvocation(argv: string[]): { appArgs: string[]; runtime: DevRunnerRuntime } {
  if (argv[0] === NODE_DEV_RUNNER_COMMAND) {
    const separatorIndex = argv.indexOf('--');
    return { appArgs: separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : argv.slice(1), runtime: 'node' };
  }

  const runtimeFlagIndex = argv.indexOf('--runtime');
  const runtime = parseDevRunnerRuntime(argv[runtimeFlagIndex + 1]);
  const separatorIndex = argv.indexOf('--');
  if (separatorIndex >= 0) {
    return { appArgs: argv.slice(separatorIndex + 1), runtime };
  }

  const appArgs = argv.slice(1).filter((arg, index, args) => arg !== '--runtime' && args[index - 1] !== '--runtime');
  return { appArgs, runtime };
}

async function normalizeGeneratorKind(value: string | undefined): Promise<GeneratorKind | undefined> {
  const { resolveGeneratorKind } = await import('./generators/manifest.js');
  return resolveGeneratorKind(value);
}

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

function isVersionCommand(value: string | undefined): boolean {
  return value === 'version' || value === '--version' || value === '-v';
}

function isCreationCommand(value: string | undefined): boolean {
  return value === 'new' || value === 'create';
}

function isHelpInvocation(argv: string[]): boolean {
  return argv[0] === 'help' || argv.some(isHelpFlag);
}

function readCliVersion(): string {
  const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const manifest: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') {
    throw new Error('Unable to determine the installed fluo CLI version.');
  }

  return manifest.version;
}

async function generateUsage(): Promise<string> {
  const { builtInGeneratorCollection, generatorManifest, generatorOptionSchemas } = await import('./generators/manifest.js');
  const generateKindHelp: GenerateKindHelpEntry[] = generatorManifest.map((entry) => ({
    aliases: [...entry.aliases],
    description: entry.description,
    kind: entry.kind,
    schematic: entry.schematic,
    wiring: entry.wiringBehavior === 'auto-registered' ? 'auto' : 'manual',
  }));
  const generateOptionHelp: GenerateOptionHelpEntry[] = generatorOptionSchemas.map((option) => ({
    aliases: [...option.aliases],
    description: option.description,
    option: option.name,
  }));

  return [
    'Usage: fluo generate|g <kind> <name> [options]',
    '       fluo generate|g request-dto|req <feature> <name> [options]',
    '       fluo generate|g e2e <name> [options]',
    '',
    'Schematics',
    renderHelpTable(generateKindHelp, [
      { header: 'Schematic', render: (entry) => entry.schematic },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Wiring', render: (entry) => entry.wiring },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    '  auto   = class is auto-registered in the domain module (created if absent)',
    '  manual = files only; you must wire the generated class into a module yourself',
    '',
    'Collections',
    `  ${builtInGeneratorCollection.id} (${builtInGeneratorCollection.source})`,
    '  External or app-local generator collections are intentionally deferred; no packages or config files are loaded by generate.',
    '',
    'Options',
    renderHelpTable(generateOptionHelp, [
      { header: 'Option', render: (entry) => entry.option },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    'Next steps:',
    '  Run \'pnpm typecheck\' to verify the generated module wiring.',
    '  Run \'pnpm test\' to execute the generated test templates.',
    '',
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/generator-workflow.md',
  ].join('\n');
}

function usage(): string {
  return [
    'Usage: fluo <command> [options]',
    '',
    'Commands',
    renderHelpTable(TOP_LEVEL_COMMAND_HELP, [
      { header: 'Command', render: (entry) => entry.command },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    'Options',
    '  --no-update-check  Skip the interactive CLI update check for this invocation.',
    '                     Alias: --no-update-notifier.',
    '',
    "Run 'fluo help <command>' for more information on a command.",
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/quick-start.md',
  ].join('\n');
}

function resolveDefaultTargetDirectory(startDirectory: string): string {
  const resolvedStartDirectory = resolve(startDirectory);

  if (existsSync(join(resolvedStartDirectory, 'package.json')) && existsSync(join(resolvedStartDirectory, 'src'))) {
    return join(resolvedStartDirectory, 'src');
  }

  if (existsSync(join(resolvedStartDirectory, 'apps'))) {
    const appDirectories = readdirSync(join(resolvedStartDirectory, 'apps'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(resolvedStartDirectory, 'apps', entry.name))
      .filter((directory) => existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'src')));

    if (appDirectories.length === 1) {
      return join(appDirectories[0], 'src');
    }

    if (appDirectories.length > 1) {
      throw new Error('Multiple app targets were found under apps/. Use --target-directory to choose the app src directory explicitly.');
    }
  }

  return resolvedStartDirectory;
}

async function parseGenerateArgs(argv: string[]): Promise<ParsedCliArgs> {
  const [command, rawKind, firstName, ...optionArgs] = argv;
  const kind = await normalizeGeneratorKind(rawKind);

  if (!(command === 'g' || command === 'generate')) {
    throw new Error(usage());
  }

  if (!kind || !firstName) {
    throw new Error(await generateUsage());
  }

  if (firstName.startsWith('-')) {
    throw new Error(`Invalid resource name "${firstName}": names cannot start with "-".`);
  }

  const parsedOptions: GenerateOptions = {};
  let name = firstName;
  let seenRequestDtoName = false;
  let targetDirectory: string | undefined;
  let seenForce = false;
  let seenDryRun = false;
  let seenTargetDirectory = false;
  let seenWithSliceTest = false;
  let seenWithTest = false;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    const next = optionArgs[index + 1];

    if (kind === 'request-dto' && !seenRequestDtoName && !option.startsWith('-')) {
      parsedOptions.targetFeature = firstName;
      name = option;
      seenRequestDtoName = true;
      continue;
    }

    if (option === '--target-directory' || option === '-o') {
      if (seenTargetDirectory) {
        throw new Error('Duplicate --target-directory option.');
      }

      if (!next || next.startsWith('-')) {
        throw new Error('Expected --target-directory to have a path value.');
      }

      targetDirectory = next;
      seenTargetDirectory = true;
      index += 1;
      continue;
    }

    if (option === '--force' || option === '-f') {
      if (seenForce) {
        throw new Error('Duplicate --force option.');
      }

      parsedOptions.force = true;
      seenForce = true;
      continue;
    }

    if (option === '--dry-run') {
      if (seenDryRun) {
        throw new Error('Duplicate --dry-run option.');
      }

      parsedOptions.dryRun = true;
      seenDryRun = true;
      continue;
    }

    if (option === '--with-test') {
      if (seenWithTest) {
        throw new Error('Duplicate --with-test option.');
      }

      parsedOptions.withTest = true;
      seenWithTest = true;
      continue;
    }

    if (option === '--with-slice-test') {
      if (seenWithSliceTest) {
        throw new Error('Duplicate --with-slice-test option.');
      }

      parsedOptions.withSliceTest = true;
      seenWithSliceTest = true;
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  if (parsedOptions.withTest && kind !== 'module') {
    throw new Error('--with-test is only supported for module generation. Use --with-slice-test for resource generation.');
  }

  if (parsedOptions.withSliceTest && kind !== 'resource') {
    throw new Error('--with-slice-test is only supported for resource generation.');
  }

  return {
    kind,
    name,
    options: parsedOptions,
    targetDirectory,
  };
}

async function parseCommand(argv: string[]): Promise<ParsedCommand> {
  const [command] = argv;

  if (command === 'analyze') {
    return { argv: argv.slice(1), command: 'analyze' };
  }

  if (command === 'add') {
    return { argv: argv.slice(1), command: 'add' };
  }

  if (command === 'doctor') {
    return { argv: argv.slice(1), command: 'doctor' };
  }

  if (command === 'info') {
    return { argv: argv.slice(1), command: 'info' };
  }

  if (command === 'build' || command === 'dev' || command === 'start') {
    return { argv: argv.slice(1), command };
  }

  if (command === 'upgrade') {
    return { argv: argv.slice(1), command: 'upgrade' };
  }

  if (command === 'new' || command === 'create') {
    return {
      argv: argv.slice(1),
      command: 'new',
    };
  }

  if (command === 'migrate') {
    return {
      argv: argv.slice(1),
      command: 'migrate',
    };
  }

  if (command === 'inspect') {
    return {
      argv: argv.slice(1),
      command: 'inspect',
    };
  }

  if (command === 'typegen') {
    return {
      argv: argv.slice(1),
      command: 'typegen',
    };
  }

  return {
    argv,
    command: 'generate',
    parsed: await parseGenerateArgs(argv),
  };
}

/**
 * Runs the top-level CLI command dispatcher and returns a process-style exit code.
 *
 * This programmatic entry point mirrors the published `fluo` binary while allowing callers to swap
 * standard streams or the working directory for tests, sandboxes, and editor integrations.
 *
 * @example
 * ```ts
 * import { runCli } from '@fluojs/cli';
 *
 * const output: string[] = [];
 * const exitCode = await runCli(['generate', 'service', 'Post'], {
 *   cwd: '/workspace/app',
 *   stdout: { write: (chunk) => output.push(String(chunk)) },
 *   stderr: { write: (chunk) => output.push(String(chunk)) },
 * });
 * ```
 *
 * @param argv Argument vector to execute. Defaults to the current process arguments without the node/bin prefix.
 * @param runtime Optional runtime overrides shared by the top-level dispatcher and delegated commands.
 * @returns `0` when the command completes successfully, otherwise the delegated command exit code.
 */
export async function runCli(
  argv = process.argv.slice(2),
  runtime: CliRuntimeOptions & NewCommandRuntimeOptions & InspectCommandRuntimeOptions & TypegenCommandRuntimeOptions = {},
): Promise<number> {
  const cwd = runtime.cwd ? resolve(runtime.cwd) : process.cwd();
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const env = runtime.env ?? process.env;
  const commandRuntime = { ...runtime, env };
  const updateFlagResult = removeUpdateCheckFlags(argv);
  const commandArgv = updateFlagResult.argv;

  try {
    if (commandArgv[0] === NODE_DEV_RUNNER_COMMAND || commandArgv[0] === DEV_RUNNER_COMMAND) {
      const runnerInvocation = parseDevRunnerInvocation(commandArgv);
      const { runNodeRestartRunner } = await import('./dev-runner/node-restart-runner.js');
      return runNodeRestartRunner({ appArgs: runnerInvocation.appArgs, env, runtime: runnerInvocation.runtime, stderr, stdout });
    }

    if (isVersionCommand(commandArgv[0])) {
      stdout.write(`${readCliVersion()}\n`);
      return 0;
    }

    if (!isHelpInvocation(commandArgv)) {
      const updateCheckOptions = runtime.updateCheck === false ? undefined : runtime.updateCheck;
      const updateCheckResult = await runCliUpdateCheck(commandArgv, {
        ...updateCheckOptions,
        ci: runtime.ci,
        env,
        bypassCache: isCreationCommand(commandArgv[0]),
        interactive: runtime.interactive,
        skip: updateFlagResult.skipUpdateCheck || runtime.updateCheck === false,
        stderr,
        stdin: runtime.stdin,
        stdout,
      });

      if (updateCheckResult.action === 'reran') {
        return updateCheckResult.exitCode;
      }
    }

    if (commandArgv.length === 0) {
      throw new Error(usage());
    }

    if (commandArgv[0] === 'help') {
      const topic = commandArgv[1];

      if (topic === 'new' || topic === 'create') {
        stdout.write(`${newUsage()}\n`);
        return 0;
      }

      if (topic === 'g' || topic === 'generate') {
        stdout.write(`${await generateUsage()}\n`);
        return 0;
      }

      if (topic === 'doctor' || topic === 'info') {
        const { diagnosticsUsage } = await import('./commands/diagnostics.js');
        stdout.write(`${diagnosticsUsage(topic)}\n`);
        return 0;
      }

      if (topic === 'analyze') {
        const { diagnosticsUsage } = await import('./commands/diagnostics.js');
        stdout.write(`${diagnosticsUsage('analyze')}\n`);
        return 0;
      }

      if (topic === 'build' || topic === 'dev' || topic === 'start') {
        const { scriptUsage } = await import('./commands/scripts.js');
        stdout.write(`${scriptUsage(topic)}\n`);
        return 0;
      }

      if (topic === 'add') {
        const { addUsage } = await import('./commands/package-workflow.js');
        stdout.write(`${addUsage()}\n`);
        return 0;
      }

      if (topic === 'upgrade') {
        const { upgradeUsage } = await import('./commands/package-workflow.js');
        stdout.write(`${upgradeUsage()}\n`);
        return 0;
      }

      if (topic === 'migrate') {
        const { migrateUsage } = await import('./commands/migrate.js');
        stdout.write(`${migrateUsage()}\n`);
        return 0;
      }

      if (topic === 'inspect') {
        stdout.write(`${inspectUsage()}\n`);
        return 0;
      }

      if (topic === 'typegen') {
        stdout.write(`${typegenUsage()}\n`);
        return 0;
      }

      stdout.write(`${usage()}\n`);
      return 0;
    }

    if (isHelpFlag(commandArgv[0])) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    if ((commandArgv[0] === 'g' || commandArgv[0] === 'generate') && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${await generateUsage()}\n`);
      return 0;
    }

    if ((commandArgv[0] === 'doctor' || commandArgv[0] === 'info') && commandArgv.slice(1).some(isHelpFlag)) {
      const { diagnosticsUsage } = await import('./commands/diagnostics.js');
      stdout.write(`${diagnosticsUsage(commandArgv[0])}\n`);
      return 0;
    }

    if (commandArgv[0] === 'analyze' && commandArgv.slice(1).some(isHelpFlag)) {
      const { diagnosticsUsage } = await import('./commands/diagnostics.js');
      stdout.write(`${diagnosticsUsage('analyze')}\n`);
      return 0;
    }

    if ((commandArgv[0] === 'build' || commandArgv[0] === 'dev' || commandArgv[0] === 'start') && commandArgv.slice(1).some(isHelpFlag)) {
      const { scriptUsage } = await import('./commands/scripts.js');
      stdout.write(`${scriptUsage(commandArgv[0])}\n`);
      return 0;
    }

    if (commandArgv[0] === 'add' && commandArgv.slice(1).some(isHelpFlag)) {
      const { addUsage } = await import('./commands/package-workflow.js');
      stdout.write(`${addUsage()}\n`);
      return 0;
    }

    if (commandArgv[0] === 'upgrade' && commandArgv.slice(1).some(isHelpFlag)) {
      const { upgradeUsage } = await import('./commands/package-workflow.js');
      stdout.write(`${upgradeUsage()}\n`);
      return 0;
    }

    if (commandArgv[0] === 'migrate' && commandArgv.slice(1).some(isHelpFlag)) {
      const { migrateUsage } = await import('./commands/migrate.js');
      stdout.write(`${migrateUsage()}\n`);
      return 0;
    }

    if (commandArgv[0] === 'inspect' && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${inspectUsage()}\n`);
      return 0;
    }

    if (commandArgv[0] === 'typegen' && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${typegenUsage()}\n`);
      return 0;
    }

    const parsedCommand = await parseCommand(commandArgv);

    if (parsedCommand.command === 'analyze') {
      const { runAnalyzeCommand } = await import('./commands/diagnostics.js');
      return runAnalyzeCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'add') {
      const { runAddCommand } = await import('./commands/package-workflow.js');
      return runAddCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'doctor') {
      const { runDoctorCommand } = await import('./commands/diagnostics.js');
      return runDoctorCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'info') {
      const { runInfoCommand } = await import('./commands/diagnostics.js');
      return runInfoCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'build' || parsedCommand.command === 'dev' || parsedCommand.command === 'start') {
      const { runScriptCommand } = await import('./commands/scripts.js');
      return await runScriptCommand(parsedCommand.command, parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'upgrade') {
      const { runUpgradeCommand } = await import('./commands/package-workflow.js');
      return runUpgradeCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'new') {
      const { runNewCommand } = await import('./commands/new.js');
      return runNewCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'migrate') {
      const { runMigrateCommand } = await import('./commands/migrate.js');
      return runMigrateCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'inspect') {
      const { runInspectCommand } = await import('./commands/inspect.js');
      return runInspectCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'typegen') {
      const { runTypegenCommand } = await import('./commands/typegen.js');
      return runTypegenCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command !== 'generate') {
      throw new Error(usage());
    }

    const targetDirectory = resolve(cwd, parsedCommand.parsed.targetDirectory ?? resolveDefaultTargetDirectory(cwd));

    const { runGenerateCommand } = await import('./commands/generate.js');
    const result = runGenerateCommand(parsedCommand.parsed.kind, parsedCommand.parsed.name, targetDirectory, parsedCommand.parsed.options);

    if (parsedCommand.parsed.options.dryRun) {
      stdout.write('Dry run: no files were written.\n');
      stdout.write(`Planned ${result.plannedFiles.length} file action(s):\n`);
      for (const file of result.plannedFiles) {
        stdout.write(`  ${file.action.toUpperCase()} ${file.path}\n`);
      }
    } else {
      stdout.write(`Generated ${result.generatedFiles.length} file(s):\n`);
      for (const file of result.generatedFiles) {
        stdout.write(`  CREATE ${file}\n`);
      }
    }

    stdout.write('\n');

    if (result.wiringBehavior === 'auto-registered' && result.moduleRegistered) {
      stdout.write(`Wiring: auto-registered in ${result.modulePath ?? 'module'}\n`);
    } else if (result.wiringBehavior === 'files-only') {
      stdout.write('Wiring: files only — manual registration required (see next steps)\n');
    }

    stdout.write(`\nNext steps:\n  ${result.nextStepHint}\n`);

    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await runCli(undefined, {
    ci: process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true',
    userAgent: process.env.npm_config_user_agent,
  });
}
