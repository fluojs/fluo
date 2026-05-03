import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_PACKAGE_MANAGERS } from './package-manager.js';

type CliStream = {
  isTTY?: boolean;
  write(message: string): unknown;
};

type LifecycleReporterMode = 'auto' | 'silent' | 'stream';
type EffectiveLifecycleReporterMode = 'pretty' | 'silent' | 'stream';

type SpawnCommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stderr?: CliStream;
  stdio: 'inherit' | 'pipe';
  stdout?: CliStream;
};

type ScriptRuntimeOptions = {
  ci?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnCommand?: (command: string, args: string[], options: SpawnCommandOptions) => Promise<number>;
  stderr?: CliStream;
  stdout?: CliStream;
};

type JsonRecord = Record<string, unknown>;
type ScriptCommand = 'build' | 'dev' | 'start';
type ProjectRuntime = 'bun' | 'cloudflare-workers' | 'deno' | 'node';
type ProjectRunnerMode = 'fluo-node-restart' | 'native-watch' | 'single-run';
type ProjectRunnerStep = { args: string[]; command: string; mode?: ProjectRunnerMode };

const EMPTY_ENV: NodeJS.ProcessEnv = {};
const FAILURE_STDOUT_BUFFER_LIMIT = 16_384;
const PRETTY_TTY_COLOR_ENV = 'FLUO_DEV_PRETTY_TTY_COLOR';
const PRETTY_CHILD_OUTPUT_PREFIX = 'app │ ';

function getCliSourceRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function getCliEntryPoint(): string {
  return join(getCliSourceRoot(), 'cli.js');
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function readJsonFile(filePath: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch (_error: unknown) {
    return undefined;
  }
}

function findProjectManifest(startDirectory: string): { directory: string; manifest: JsonRecord; path: string } | undefined {
  let current = resolve(startDirectory);

  while (true) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      const manifest = readJsonFile(candidate);
      if (manifest) {
        return { directory: current, manifest, path: candidate };
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

function hasManifestDependency(manifest: JsonRecord, packageName: string): boolean {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entries = manifest[field];
    if (isRecord(entries) && typeof entries[packageName] === 'string') {
      return true;
    }
  }

  return false;
}

function detectProjectRuntime(manifest: JsonRecord): ProjectRuntime {
  if (hasManifestDependency(manifest, '@fluojs/platform-bun')) {
    return 'bun';
  }

  if (hasManifestDependency(manifest, '@fluojs/platform-deno')) {
    return 'deno';
  }

  if (hasManifestDependency(manifest, '@fluojs/platform-cloudflare-workers')) {
    return 'cloudflare-workers';
  }

  return 'node';
}

function withDefaultNodeEnv(env: NodeJS.ProcessEnv, defaultNodeEnv: 'development' | 'production'): NodeJS.ProcessEnv {
  if (env.NODE_ENV) {
    return { ...env };
  }

  return { ...env, NODE_ENV: defaultNodeEnv };
}

function findPathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
}

function withProjectLocalBin(env: NodeJS.ProcessEnv, projectDirectory: string): NodeJS.ProcessEnv {
  const pathKey = findPathEnvKey(env);
  const existingPath = env[pathKey];
  const localBin = join(projectDirectory, 'node_modules', '.bin');

  return {
    ...env,
    [pathKey]: existingPath ? `${localBin}${delimiter}${existingPath}` : localBin,
  };
}

function withPrettyReporterColorEnv(env: NodeJS.ProcessEnv, mode: EffectiveLifecycleReporterMode, stdout: CliStream, stderr: CliStream): NodeJS.ProcessEnv {
  if (mode !== 'pretty' || env.NO_COLOR !== undefined) {
    return env;
  }

  if (!stdout.isTTY && !stderr.isTTY) {
    return env;
  }

  return { ...env, [PRETTY_TTY_COLOR_ENV]: '1' };
}

function defaultSpawnCommand(command: string, args: string[], options: SpawnCommandOptions): Promise<number> {
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(command, args, options);
    if (options.stdio === 'pipe') {
      child.stdout?.on('data', (chunk) => options.stdout?.write(String(chunk)));
      child.stderr?.on('data', (chunk) => options.stderr?.write(String(chunk)));
    }
    child.on('error', reject);
    child.on('close', (code) => resolveExitCode(code ?? 1));
  });
}

function buildNativeNodeWatchStep(passThrough: string[]): ProjectRunnerStep {
  return { command: 'node', args: ['--env-file=.env', '--watch', '--watch-preserve-output', '--import', 'tsx', 'src/main.ts', ...passThrough], mode: 'native-watch' };
}

function buildProjectRunner(command: ScriptCommand, runtime: ProjectRuntime, passThrough: string[], options: { rawWatch: boolean }): ProjectRunnerStep[] {
  if (command === 'build') {
    switch (runtime) {
      case 'bun':
        return [{ command: 'bun', args: ['build', './src/main.ts', '--outdir', './dist', '--target', 'bun', ...passThrough] }];
      case 'deno':
        return [{ command: 'deno', args: ['compile', '--allow-env', '--allow-net', '--output', join('dist', 'app'), 'src/main.ts', ...passThrough] }];
      case 'cloudflare-workers':
        return [{ command: 'wrangler', args: ['deploy', '--dry-run', ...passThrough] }];
      default:
        return [
          { command: 'vite', args: ['build', ...passThrough], mode: 'single-run' },
          { command: 'tsc', args: ['-p', 'tsconfig.build.json'], mode: 'single-run' },
        ];
    }
  }

  if (command === 'dev') {
    switch (runtime) {
      case 'bun':
        return [{ command: 'bun', args: ['--watch', 'src/main.ts', ...passThrough] }];
      case 'deno':
        return [{ command: 'deno', args: ['run', '--allow-env', '--allow-net', '--watch', 'src/main.ts', ...passThrough] }];
      case 'cloudflare-workers':
        return [{ command: 'wrangler', args: ['dev', ...passThrough], mode: 'native-watch' }];
      default:
        if (options.rawWatch) {
          return [buildNativeNodeWatchStep(passThrough)];
        }
        return [{ command: 'node', args: ['--import', 'tsx', getCliEntryPoint(), '__node-dev-runner', '--', ...passThrough], mode: 'fluo-node-restart' }];
    }
  }

  switch (runtime) {
    case 'bun':
      return [{ command: 'bun', args: ['dist/main.js', ...passThrough] }];
    case 'deno':
      return [{ command: join('dist', 'app'), args: [...passThrough] }];
    case 'cloudflare-workers':
      return [{ command: 'wrangler', args: ['dev', '--remote', ...passThrough] }];
    default:
      return [{ command: 'node', args: ['dist/main.js', ...passThrough], mode: 'single-run' }];
  }
}

async function runProjectRunnerSteps(
  steps: ProjectRunnerStep[],
  runtime: Required<Pick<ScriptRuntimeOptions, 'spawnCommand'>>,
  options: SpawnCommandOptions,
): Promise<number> {
  for (const step of steps) {
    const exitCode = await runtime.spawnCommand(step.command, step.args, options);
    if (exitCode !== 0) {
      return exitCode;
    }
  }

  return 0;
}

function parseScriptArgs(argv: string[]): { dryRun: boolean; packageManager?: string; passThrough: string[]; rawWatch: boolean; reporter: LifecycleReporterMode; verbose: boolean } {
  let dryRun = false;
  let packageManager: string | undefined;
  let rawWatch = false;
  let reporter: LifecycleReporterMode = 'auto';
  let verbose = false;
  const passThrough: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--verbose') {
      verbose = true;
      continue;
    }

    if (arg === '--raw-watch') {
      rawWatch = true;
      continue;
    }

    if (arg === '--reporter') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Expected --reporter to have a value.');
      }
      if (!(value === 'auto' || value === 'stream' || value === 'silent')) {
        throw new Error(`Invalid --reporter value "${value}". Use one of: auto, stream, silent.`);
      }
      reporter = value;
      index += 1;
      continue;
    }

    if (arg === '--package-manager') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Expected --package-manager to have a value.');
      }
      if (!SUPPORTED_PACKAGE_MANAGERS.has(value)) {
        throw new Error(`Invalid --package-manager value "${value}". Use one of: pnpm, npm, yarn, bun.`);
      }
      packageManager = value;
      index += 1;
      continue;
    }

    if (arg === '--') {
      passThrough.push(...argv.slice(index + 1));
      break;
    }

    passThrough.push(arg);
  }

  return { dryRun, packageManager, passThrough, rawWatch, reporter, verbose };
}

function isEnabledEnvironmentFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function resolveReporterMode(command: ScriptCommand, parsed: { reporter: LifecycleReporterMode; verbose: boolean }, runtime: ScriptRuntimeOptions): EffectiveLifecycleReporterMode {
  if (parsed.reporter !== 'auto') {
    return parsed.reporter;
  }

  if (parsed.verbose || isEnabledEnvironmentFlag(runtime.env?.FLUO_VERBOSE)) {
    return 'stream';
  }

  if (runtime.ci || isEnabledEnvironmentFlag(runtime.env?.CI) || isEnabledEnvironmentFlag(runtime.env?.GITHUB_ACTIONS)) {
    return 'stream';
  }

  if (command !== 'dev') {
    return 'stream';
  }

  return (runtime.stdout ?? process.stdout).isTTY ? 'pretty' : 'stream';
}

function renderStep(step: ProjectRunnerStep): string {
  return `${step.command} ${step.args.join(' ')}`.trim();
}

function createBoundedBufferStream(limit: number): CliStream & { flush(target: CliStream): void; hasContent(): boolean } {
  let buffer = '';

  return {
    flush(target) {
      if (buffer.length > 0) {
        target.write(buffer);
      }
    },
    hasContent() {
      return buffer.length > 0;
    },
    write(message) {
      buffer += message;
      if (buffer.length > limit) {
        buffer = buffer.slice(buffer.length - limit);
      }
    },
  };
}

type FinalizableCliStream = CliStream & { finalizeLine(): void };

function createLinePrefixedStream(target: CliStream, prefix: string): FinalizableCliStream {
  let atLineStart = true;

  return {
    finalizeLine() {
      if (!atLineStart) {
        target.write('\n');
        atLineStart = true;
      }
    },
    write(message) {
      for (const character of message) {
        if (atLineStart && character !== '\n') {
          target.write(prefix);
          atLineStart = false;
        }

        target.write(character);

        if (character === '\n') {
          atLineStart = true;
        }
      }
    },
  };
}

function createReporterStreams(
  mode: EffectiveLifecycleReporterMode,
  verbose: boolean,
  stdout: CliStream,
  stderr: CliStream,
): { finalizeChildOutputBeforeStatus(): void; flushBufferedStdoutOnFailure(): void; stderr?: CliStream; stdio: 'inherit' | 'pipe'; stdout?: CliStream } {
  if (mode === 'stream') {
    return { finalizeChildOutputBeforeStatus() {}, flushBufferedStdoutOnFailure() {}, stdio: 'inherit' };
  }

  if (mode === 'pretty') {
    if (verbose) {
      return { finalizeChildOutputBeforeStatus() {}, flushBufferedStdoutOnFailure() {}, stderr, stdio: 'pipe', stdout };
    }

    const prefixedStdout = createLinePrefixedStream(stdout, PRETTY_CHILD_OUTPUT_PREFIX);
    const prefixedStderr = createLinePrefixedStream(stderr, PRETTY_CHILD_OUTPUT_PREFIX);

    return {
      finalizeChildOutputBeforeStatus() {
        prefixedStdout.finalizeLine();
        prefixedStderr.finalizeLine();
      },
      flushBufferedStdoutOnFailure() {},
      stderr: prefixedStderr,
      stdio: 'pipe',
      stdout: prefixedStdout,
    };
  }

  if (mode === 'silent') {
    if (verbose) {
      return { finalizeChildOutputBeforeStatus() {}, flushBufferedStdoutOnFailure() {}, stderr, stdio: 'pipe', stdout };
    }

    const bufferedStdout = createBoundedBufferStream(FAILURE_STDOUT_BUFFER_LIMIT);

    return {
      finalizeChildOutputBeforeStatus() {},
      flushBufferedStdoutOnFailure() {
        if (bufferedStdout.hasContent()) {
          stderr.write('[fluo] child stdout before failure:\n');
          bufferedStdout.flush(stderr);
          stderr.write('\n');
        }
      },
      stderr,
      stdio: 'pipe',
      stdout: bufferedStdout,
    };
  }

  return { finalizeChildOutputBeforeStatus() {}, flushBufferedStdoutOnFailure() {}, stdio: 'inherit' };
}

/**
 * Renders lifecycle command help text.
 *
 * @param command Lifecycle command whose help text should be rendered.
 * @returns Human-readable lifecycle command usage text.
 */
export function scriptUsage(command: ScriptCommand): string {
  const nodeEnv = command === 'dev' ? 'development' : 'production';
  return [
    `Usage: fluo ${command} [options] [-- <args>]`,
    '',
    `Run the generated fluo project ${command} lifecycle with NODE_ENV defaulting to ${nodeEnv} when unset.`,
    '',
    'Options',
    '  --dry-run                              Print the command without running it.',
    command === 'dev' ? '  --raw-watch                            Use the runtime-native watcher instead of the fluo Node restart runner.' : undefined,
    '  --reporter <auto|stream|silent>        Choose lifecycle reporter output mode (default: auto).',
    '  --verbose                             Expose raw child process output; also honored by FLUO_VERBOSE=1.',
    `  --help                                 Show help for the ${command} command.`,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

/**
 * Runs one generated-project lifecycle command through the CLI-owned runtime command matrix.
 *
 * @param command Lifecycle command to run.
 * @param argv Command-specific arguments after the lifecycle command name.
 * @param runtime Runtime dependencies used by tests, sandboxes, and embedders.
 * @returns Process-style exit code from the lifecycle command.
 */
export async function runScriptCommand(command: ScriptCommand, argv: string[], runtime: ScriptRuntimeOptions = {}): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    (runtime.stdout ?? process.stdout).write(`${scriptUsage(command)}\n`);
    return 0;
  }

  const env = runtime.env ?? EMPTY_ENV;
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const project = findProjectManifest(runtime.cwd ?? process.cwd());
  if (!project) {
    throw new Error(`Unable to find package.json for fluo ${command}.`);
  }

  const parsed = parseScriptArgs(argv);

  const projectRuntime = detectProjectRuntime(project.manifest);
  const defaultNodeEnv = command === 'dev' ? 'development' : 'production';
  const rawWatch = parsed.rawWatch || isEnabledEnvironmentFlag(env.FLUO_DEV_RAW_WATCH);
  const runnerSteps = buildProjectRunner(command, projectRuntime, parsed.passThrough, { rawWatch });
  const reporterMode = resolveReporterMode(command, parsed, { ...runtime, env, stdout });
  const childEnv = withPrettyReporterColorEnv(withProjectLocalBin(withDefaultNodeEnv(env, defaultNodeEnv), project.directory), reporterMode, stdout, stderr);
  const verbose = parsed.verbose || isEnabledEnvironmentFlag(env.FLUO_VERBOSE);

  if (parsed.dryRun) {
    for (const step of runnerSteps) {
      stdout.write(`Would run: ${step.command} ${step.args.join(' ')}\n`);
    }
    stdout.write(`Project: ${project.path}\n`);
    stdout.write(`Runtime: ${projectRuntime}\n`);
    stdout.write(`NODE_ENV: ${childEnv.NODE_ENV ?? ''}\n`);
    stdout.write(`Reporter: ${reporterMode}\n`);
    if (command === 'dev') {
      stdout.write(`Watch mode: ${runnerSteps.map((step) => step.mode ?? 'single-run').join(', ')}\n`);
    }
    return 0;
  }

  if (reporterMode === 'pretty') {
    stdout.write(`[fluo] ${command} ${projectRuntime} lifecycle starting\n`);
    stdout.write(`[fluo] ${runnerSteps.map(renderStep).join(' && ')}\n`);
  }

  const reporterStreams = createReporterStreams(reporterMode, verbose, stdout, stderr);
  const exitCode = await runProjectRunnerSteps(runnerSteps, { spawnCommand: runtime.spawnCommand ?? defaultSpawnCommand }, {
    cwd: project.directory,
    env: childEnv,
    ...reporterStreams,
  });

  if (reporterMode === 'pretty') {
    reporterStreams.finalizeChildOutputBeforeStatus();
    if (exitCode === 0) {
      stdout.write(`[fluo] ${command} lifecycle completed\n`);
    } else {
      reporterStreams.flushBufferedStdoutOnFailure();
      stderr.write(`[fluo] ${command} lifecycle failed with exit code ${exitCode}\n`);
    }
  } else if (reporterMode === 'silent' && exitCode !== 0) {
    reporterStreams.flushBufferedStdoutOnFailure();
    stderr.write(`[fluo] ${command} lifecycle failed with exit code ${exitCode}\n`);
  }

  return exitCode;
}
