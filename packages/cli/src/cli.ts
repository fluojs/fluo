import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnosticsUsage, runAnalyzeCommand, runDoctorCommand, runInfoCommand } from './commands/diagnostics.js';
import { runGenerateCommand } from './commands/generate.js';
import { type InspectCommandRuntimeOptions, inspectUsage, runInspectCommand } from './commands/inspect.js';
import { migrateUsage, runMigrateCommand } from './commands/migrate.js';
import { type NewCommandRuntimeOptions, newUsage, runNewCommand } from './commands/new.js';
import { addUsage, runAddCommand, runUpgradeCommand, upgradeUsage } from './commands/package-workflow.js';
import { runScriptCommand, scriptUsage } from './commands/scripts.js';
import { builtInGeneratorCollection, generatorManifest, generatorOptionSchemas, resolveGeneratorKind } from './generators/manifest.js';
import { renderAliasList, renderHelpTable } from './help.js';
import type { GenerateOptions, GeneratorKind } from './types.js';
import { type CliUpdateCheckRuntimeOptions, removeUpdateCheckFlags, runCliUpdateCheck } from './update-check.js';

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
  spawnCommand?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }) => Promise<number>;
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

const GENERATE_KIND_HELP: GenerateKindHelpEntry[] = [
  ...generatorManifest.map((entry) => ({
    aliases: [...entry.aliases],
    description: entry.description,
    kind: entry.kind,
    schematic: entry.schematic,
    wiring: entry.wiringBehavior === 'auto-registered' ? 'auto' : 'manual',
  })),
];

const GENERATE_OPTION_HELP: GenerateOptionHelpEntry[] = [
  ...generatorOptionSchemas.map((option) => ({
    aliases: [...option.aliases],
    description: option.description,
    option: option.name,
  })),
];

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
  { aliases: [], command: 'migrate', description: 'Run NestJS-to-fluo codemods (dry-run by default).' },
  { aliases: ['--version', '-v'], command: 'version', description: 'Print the installed fluo CLI version.' },
  { aliases: [], command: 'help', description: 'Show top-level or command-specific help.' },
];

function normalizeGeneratorKind(value: string | undefined): GeneratorKind | undefined {
  return resolveGeneratorKind(value);
}

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

function isVersionCommand(value: string | undefined): boolean {
  return value === 'version' || value === '--version' || value === '-v';
}

function readCliVersion(): string {
  const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const manifest: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') {
    throw new Error('Unable to determine the installed fluo CLI version.');
  }

  return manifest.version;
}

function generateUsage(): string {
  return [
    'Usage: fluo generate|g <kind> <name> [options]',
    '       fluo generate|g request-dto|req <feature> <name> [options]',
    '',
    'Schematics',
    renderHelpTable(GENERATE_KIND_HELP, [
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
    renderHelpTable(GENERATE_OPTION_HELP, [
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

function parseGenerateArgs(argv: string[]): ParsedCliArgs {
  const [command, rawKind, firstName, ...optionArgs] = argv;
  const kind = normalizeGeneratorKind(rawKind);

  if (!(command === 'g' || command === 'generate')) {
    throw new Error(usage());
  }

  if (!kind || !firstName) {
    throw new Error(generateUsage());
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

    throw new Error(`Unknown option: ${option}`);
  }

  return {
    kind,
    name,
    options: parsedOptions,
    targetDirectory,
  };
}

function parseCommand(argv: string[]): ParsedCommand {
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

  return {
    argv,
    command: 'generate',
    parsed: parseGenerateArgs(argv),
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
 * @returns `0` when the command completes successfully, otherwise `1` after writing the error message to `stderr`.
 */
export async function runCli(
  argv = process.argv.slice(2),
  runtime: CliRuntimeOptions & NewCommandRuntimeOptions & InspectCommandRuntimeOptions = {},
): Promise<number> {
  const cwd = runtime.cwd ? resolve(runtime.cwd) : process.cwd();
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const env = runtime.env ?? process.env;
  const commandRuntime = { ...runtime, env };
  const updateFlagResult = removeUpdateCheckFlags(argv);
  const commandArgv = updateFlagResult.argv;

  try {
    if (isVersionCommand(commandArgv[0])) {
      stdout.write(`${readCliVersion()}\n`);
      return 0;
    }

    const updateCheckOptions = runtime.updateCheck === false ? undefined : runtime.updateCheck;
    const updateCheckResult = await runCliUpdateCheck(commandArgv, {
      ...updateCheckOptions,
      ci: runtime.ci,
      env,
      interactive: runtime.interactive,
      skip: updateFlagResult.skipUpdateCheck || runtime.updateCheck === false,
      stderr,
      stdin: runtime.stdin,
      stdout,
    });

    if (updateCheckResult.action === 'reran') {
      return updateCheckResult.exitCode;
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
        stdout.write(`${generateUsage()}\n`);
        return 0;
      }

      if (topic === 'doctor' || topic === 'info') {
        stdout.write(`${diagnosticsUsage('doctor')}\n`);
        return 0;
      }

      if (topic === 'analyze') {
        stdout.write(`${diagnosticsUsage('analyze')}\n`);
        return 0;
      }

      if (topic === 'build' || topic === 'dev' || topic === 'start') {
        stdout.write(`${scriptUsage(topic)}\n`);
        return 0;
      }

      if (topic === 'add') {
        stdout.write(`${addUsage()}\n`);
        return 0;
      }

      if (topic === 'upgrade') {
        stdout.write(`${upgradeUsage()}\n`);
        return 0;
      }

      if (topic === 'migrate') {
        stdout.write(`${migrateUsage()}\n`);
        return 0;
      }

      if (topic === 'inspect') {
        stdout.write(`${inspectUsage()}\n`);
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
      stdout.write(`${generateUsage()}\n`);
      return 0;
    }

    if ((commandArgv[0] === 'doctor' || commandArgv[0] === 'info') && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${diagnosticsUsage('doctor')}\n`);
      return 0;
    }

    if (commandArgv[0] === 'analyze' && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${diagnosticsUsage('analyze')}\n`);
      return 0;
    }

    if ((commandArgv[0] === 'build' || commandArgv[0] === 'dev' || commandArgv[0] === 'start') && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${scriptUsage(commandArgv[0])}\n`);
      return 0;
    }

    if (commandArgv[0] === 'add' && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${addUsage()}\n`);
      return 0;
    }

    if (commandArgv[0] === 'upgrade' && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${upgradeUsage()}\n`);
      return 0;
    }

    if (commandArgv[0] === 'migrate' && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${migrateUsage()}\n`);
      return 0;
    }

    if (commandArgv[0] === 'inspect' && commandArgv.slice(1).some(isHelpFlag)) {
      stdout.write(`${inspectUsage()}\n`);
      return 0;
    }

    const parsedCommand = parseCommand(commandArgv);

    if (parsedCommand.command === 'analyze') {
      return runAnalyzeCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'add') {
      return runAddCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'doctor') {
      return runDoctorCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'info') {
      return runInfoCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'build' || parsedCommand.command === 'dev' || parsedCommand.command === 'start') {
      return runScriptCommand(parsedCommand.command, parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'upgrade') {
      return runUpgradeCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'new') {
      return runNewCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'migrate') {
      return runMigrateCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command === 'inspect') {
      return runInspectCommand(parsedCommand.argv, commandRuntime);
    }

    if (parsedCommand.command !== 'generate') {
      throw new Error(usage());
    }

    const targetDirectory = resolve(cwd, parsedCommand.parsed.targetDirectory ?? resolveDefaultTargetDirectory(cwd));

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
