import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioDevtoolsNodeImport } from '../studio/runtime-config.js';
import type { startStudioSidecar, StudioSidecar, StudioSidecarRuntime } from '../studio/sidecar.js';
import { SUPPORTED_PACKAGE_MANAGERS } from './package-manager.js';

type CliStream = {
  isTTY?: boolean;
  write(message: string): unknown;
};

type LifecycleReporterMode = 'auto' | 'pretty' | 'silent' | 'stream';
type EffectiveLifecycleReporterMode = 'app' | 'pretty' | 'silent' | 'stream';
type DevRunnerPreference = 'fluo' | 'native';

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
  startStudioSidecar?: typeof startStudioSidecar;
  stderr?: CliStream;
  stdout?: CliStream;
};

type StartStudioSidecar = typeof startStudioSidecar;

type JsonRecord = Record<string, unknown>;
type ScriptCommand = 'build' | 'dev' | 'start';
type ProjectRuntime = 'bun' | 'cloudflare-workers' | 'deno' | 'node';
type ProjectRunnerMode = 'fluo-restart' | 'native-watch' | 'runtime-native-watch' | 'single-run';
type ProjectRunnerStep = { args: string[]; command: string; mode?: ProjectRunnerMode };

const EMPTY_ENV: NodeJS.ProcessEnv = {};
const FAILURE_STDOUT_BUFFER_LIMIT = 16_384;
const PRETTY_TTY_COLOR_ENV = 'FLUO_DEV_PRETTY_TTY_COLOR';
const PRETTY_CHILD_OUTPUT_PREFIX = 'app │ ';
const SHOW_NODE_RESTART_NOTICE_ENV = 'FLUO_DEV_SHOW_RESTART_NOTICE';

function getCliSourceRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function getCliEntryPoint(): string {
  return join(getCliSourceRoot(), 'cli.js');
}

function getPreserveColorTtyImport(): string {
  return join(getCliSourceRoot(), 'dev-runner', 'preserve-color-tty.js');
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

function withPipedReporterColorEnv(env: NodeJS.ProcessEnv, mode: EffectiveLifecycleReporterMode, stdout: CliStream, stderr: CliStream): NodeJS.ProcessEnv {
  if (!(mode === 'app' || mode === 'pretty') || env.NO_COLOR !== undefined) {
    return env;
  }

  if (!stdout.isTTY || !stderr.isTTY) {
    return env;
  }

  return { ...env, FORCE_COLOR: env.FORCE_COLOR ?? '1', [PRETTY_TTY_COLOR_ENV]: '1' };
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

async function loadDefaultStudioSidecarFactory(): Promise<StartStudioSidecar> {
  const { startStudioSidecar: startStudioSidecarImplementation } = await import('../studio/sidecar.js');
  return startStudioSidecarImplementation;
}

function buildNativeNodeWatchStep(passThrough: string[]): ProjectRunnerStep {
  return { command: 'node', args: ['--env-file=.env', '--watch', '--watch-preserve-output', '--import', 'tsx', 'src/main.ts', ...passThrough], mode: 'native-watch' };
}

function buildFluoDevRunnerStep(runtime: ProjectRuntime, passThrough: string[]): ProjectRunnerStep {
  return { command: 'node', args: ['--import', 'tsx', getCliEntryPoint(), '__dev-runner', '--runtime', runtime, '--', ...passThrough], mode: 'fluo-restart' };
}

function buildNativeRuntimeDevStep(runtime: ProjectRuntime, passThrough: string[]): ProjectRunnerStep | undefined {
  switch (runtime) {
    case 'node':
      return buildNativeNodeWatchStep(passThrough);
    case 'bun':
      return { command: 'bun', args: ['--watch', 'src/main.ts', ...passThrough], mode: 'runtime-native-watch' };
    case 'deno':
      return { command: 'deno', args: ['run', '--watch', '--allow-env', '--allow-net', 'src/main.ts', ...passThrough], mode: 'runtime-native-watch' };
    case 'cloudflare-workers':
      return { command: 'wrangler', args: ['dev', '--show-interactive-dev-session=false', ...passThrough], mode: 'runtime-native-watch' };
    default:
      return undefined;
  }
}

function buildProjectRunner(command: ScriptCommand, runtime: ProjectRuntime, passThrough: string[], options: { devRunner: DevRunnerPreference; rawWatch: boolean }): ProjectRunnerStep[] {
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
    if (options.devRunner === 'native') {
      const nativeStep = buildNativeRuntimeDevStep(runtime, passThrough);
      if (nativeStep) {
        return [nativeStep];
      }
    }

    switch (runtime) {
      case 'bun':
        return [buildFluoDevRunnerStep(runtime, passThrough)];
      case 'deno':
        return [buildFluoDevRunnerStep(runtime, passThrough)];
      case 'cloudflare-workers':
        return [buildFluoDevRunnerStep(runtime, passThrough)];
      default:
        if (options.rawWatch) {
          return [buildNativeNodeWatchStep(passThrough)];
        }
        return [buildFluoDevRunnerStep(runtime, passThrough)];
    }
  }

  switch (runtime) {
    case 'bun':
      return [{ command: 'bun', args: ['dist/main.js', ...passThrough] }];
    case 'deno':
      return [{ command: join('dist', 'app'), args: [...passThrough] }];
    case 'cloudflare-workers':
      return [{ command: 'wrangler', args: ['dev', '--remote', '--show-interactive-dev-session=false', ...passThrough] }];
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

function withPipedAppBootstrapImports(steps: ProjectRunnerStep[], env: NodeJS.ProcessEnv): ProjectRunnerStep[] {
  return steps.map((step) => {
    const preserveColorTtyImport = getPreserveColorTtyImport();
    const colorImport = env[PRETTY_TTY_COLOR_ENV] === '1' ? ['--import', preserveColorTtyImport] : [];
    const studioDevtoolsImport = step.mode === 'fluo-restart' ? [] : createStudioDevtoolsNodeImport(env);

    if (step.command === 'node') {
      return { ...step, args: [...colorImport, ...studioDevtoolsImport, ...step.args] };
    }

    if (env[PRETTY_TTY_COLOR_ENV] === '1' && step.command === 'bun' && (step.mode === 'runtime-native-watch' || step.args[0] === 'dist/main.js')) {
      return { ...step, args: ['--preload', preserveColorTtyImport, ...step.args] };
    }

    return step;
  });
}

function parseScriptArgs(argv: string[]): { devRunner?: DevRunnerPreference; dryRun: boolean; packageManager?: string; passThrough: string[]; rawWatch: boolean; reporter: LifecycleReporterMode; studio: boolean; studioPort?: number; verbose: boolean } {
  let devRunner: DevRunnerPreference | undefined;
  let dryRun = false;
  let packageManager: string | undefined;
  let rawWatch = false;
  let reporter: LifecycleReporterMode = 'auto';
  let studio = false;
  let studioPort: number | undefined;
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

    if (arg === '--runner') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Expected --runner to have a value.');
      }
      if (!(value === 'fluo' || value === 'native')) {
        throw new Error(`Invalid --runner value "${value}". Use one of: fluo, native.`);
      }
      devRunner = value;
      index += 1;
      continue;
    }

    if (arg === '--reporter') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Expected --reporter to have a value.');
      }
      if (!(value === 'auto' || value === 'pretty' || value === 'stream' || value === 'silent')) {
        throw new Error(`Invalid --reporter value "${value}". Use one of: auto, pretty, stream, silent.`);
      }
      reporter = value;
      index += 1;
      continue;
    }

    if (arg === '--studio') {
      studio = true;
      continue;
    }

    if (arg === '--studio-port') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Expected --studio-port to have a value.');
      }
      const parsedPort = Number(value);
      if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65_535) {
        throw new Error('Invalid --studio-port value. Use a TCP port between 0 and 65535.');
      }
      studio = true;
      studioPort = parsedPort;
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

  return { devRunner, dryRun, packageManager, passThrough, rawWatch, reporter, studio, studioPort, verbose };
}

function isEnabledEnvironmentFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function resolveReporterMode(parsed: { reporter: LifecycleReporterMode; verbose: boolean }, runtime: ScriptRuntimeOptions): EffectiveLifecycleReporterMode {
  if (parsed.reporter !== 'auto') {
    return parsed.reporter;
  }

  if (parsed.verbose || isEnabledEnvironmentFlag(runtime.env?.FLUO_VERBOSE)) {
    return 'stream';
  }

  return 'app';
}

function resolveDevRunnerPreference(parsed: { devRunner?: DevRunnerPreference }, env: NodeJS.ProcessEnv, runtime: ProjectRuntime): DevRunnerPreference {
  const configured = parsed.devRunner ?? env.FLUO_DEV_RUNNER;
  if (configured === undefined || configured === '') {
    return runtime === 'node' ? 'fluo' : 'native';
  }

  if (configured === 'fluo' || configured === 'native') {
    return configured;
  }

  throw new Error(`Invalid FLUO_DEV_RUNNER value "${configured}". Use one of: fluo, native.`);
}

function projectRuntimeToStudioRuntime(runtime: ProjectRuntime): StudioSidecarRuntime {
  if (runtime === 'bun' || runtime === 'deno' || runtime === 'node') {
    return runtime;
  }

  return 'unknown';
}

function projectDisplayName(project: { directory: string; manifest: JsonRecord }): string {
  return typeof project.manifest.name === 'string' && project.manifest.name.length > 0
    ? project.manifest.name
    : project.directory.split(/[\\/]/).filter(Boolean).at(-1) ?? 'fluo-app';
}

function assertStudioSupport(command: ScriptCommand, studio: boolean, projectRuntime: ProjectRuntime, devRunner: DevRunnerPreference, rawWatch: boolean): void {
  if (!studio) {
    return;
  }

  if (command !== 'dev') {
    throw new Error('--studio is only supported for fluo dev.');
  }

  if (projectRuntime !== 'node') {
    throw new Error(`fluo dev --studio currently supports Node dev runner projects only. ${projectRuntime} Studio support remains experimental until a dedicated bridge is implemented and verified.`);
  }

  if (devRunner !== 'fluo' || rawWatch) {
    throw new Error('fluo dev --studio requires the fluo-owned Node restart runner. Remove --raw-watch and use --runner fluo so Studio lifecycle events stay attached to the CLI restart boundary.');
  }
}

function withStudioDryRunEnv(env: NodeJS.ProcessEnv, project: { directory: string; manifest: JsonRecord }, projectRuntime: ProjectRuntime): NodeJS.ProcessEnv {
  return {
    ...env,
    FLUO_STUDIO: '1',
    FLUO_STUDIO_APP_ID: projectDisplayName(project),
    FLUO_STUDIO_EPOCH: '<generated-at-runtime>',
    FLUO_STUDIO_RUNTIME: projectRuntimeToStudioRuntime(projectRuntime),
    FLUO_STUDIO_TOKEN: '<generated-at-runtime>',
    FLUO_STUDIO_URL: 'http://127.0.0.1:<auto>',
  };
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

  if (mode === 'app') {
    return { finalizeChildOutputBeforeStatus() {}, flushBufferedStdoutOnFailure() {}, stderr, stdio: 'pipe', stdout };
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

function colorizeRunnerSteps(steps: ProjectRunnerStep[], env: NodeJS.ProcessEnv): ProjectRunnerStep[] {
  return withPipedAppBootstrapImports(steps, env);
}

async function executeRunnerStepsWithReporter(options: {
  childEnv: NodeJS.ProcessEnv;
  command: ScriptCommand;
  projectDirectory: string;
  projectRuntime: ProjectRuntime;
  reporterMode: EffectiveLifecycleReporterMode;
  runnerSteps: ProjectRunnerStep[];
  runtime: ScriptRuntimeOptions;
  stderr: CliStream;
  stdout: CliStream;
  verbose: boolean;
}): Promise<number> {
  if (options.command === 'dev' && (options.reporterMode === 'pretty' || options.verbose)) {
    options.childEnv[SHOW_NODE_RESTART_NOTICE_ENV] = '1';
  }

  if (options.reporterMode === 'pretty') {
    options.stdout.write(`[fluo] ${options.command} ${options.projectRuntime} lifecycle starting\n`);
    options.stdout.write(`[fluo] ${options.runnerSteps.map(renderStep).join(' && ')}\n`);
  }

  const reporterStreams = createReporterStreams(options.reporterMode, options.verbose, options.stdout, options.stderr);
  const exitCode = await runProjectRunnerSteps(options.runnerSteps, { spawnCommand: options.runtime.spawnCommand ?? defaultSpawnCommand }, {
    cwd: options.projectDirectory,
    env: options.childEnv,
    ...reporterStreams,
  });

  if (options.reporterMode === 'pretty') {
    reporterStreams.finalizeChildOutputBeforeStatus();
    if (exitCode === 0) {
      options.stdout.write(`[fluo] ${options.command} lifecycle completed\n`);
    } else {
      reporterStreams.flushBufferedStdoutOnFailure();
      options.stderr.write(`[fluo] ${options.command} lifecycle failed with exit code ${exitCode}\n`);
    }
  } else if (options.reporterMode === 'silent' && exitCode !== 0) {
    reporterStreams.flushBufferedStdoutOnFailure();
    options.stderr.write(`[fluo] ${options.command} lifecycle failed with exit code ${exitCode}\n`);
  }

  return exitCode;
}

async function runScriptWithStudioSidecar(
  command: ScriptCommand,
  projectDirectory: string,
  projectRuntime: ProjectRuntime,
  runnerSteps: ProjectRunnerStep[],
  childEnv: NodeJS.ProcessEnv,
  runtime: ScriptRuntimeOptions,
  reporterMode: EffectiveLifecycleReporterMode,
  verbose: boolean,
  stdout: CliStream,
  stderr: CliStream,
  studioSidecar: StudioSidecar,
): Promise<number> {
  try {
    return await executeRunnerStepsWithReporter({
      childEnv,
      command,
      projectDirectory,
      projectRuntime,
      reporterMode,
      runnerSteps,
      runtime,
      stderr,
      stdout,
      verbose,
    });
  } finally {
    await studioSidecar.close();
  }
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
    'Default output forwards child stdout/stderr without fluo lifecycle UI.',
    'Use --reporter pretty for fluo lifecycle status + app │ prefixes.',
    'Use --verbose (or FLUO_VERBOSE=1) to expose raw runtime/tooling output.',
    '',
    'Options',
    '  --dry-run                              Print the command without running it.',
    command === 'dev' ? '  --raw-watch                            Use the runtime-native Node watcher instead of the fluo restart runner.' : undefined,
    command === 'dev' ? '  --runner <fluo|native>                 Select fluo restart supervision or runtime-native watch (default: fluo for Node, native for non-Node runtimes).' : undefined,
    command === 'dev' ? '  --studio                              Start the local Fluo Studio sidecar and inject runtime devtool env.' : undefined,
    command === 'dev' ? '  --studio-port <port>                  Bind the Studio sidecar to a specific local port (default: 0).' : undefined,
    '  --reporter <auto|pretty|stream|silent> Choose lifecycle reporter output mode (default: auto).',
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
  if (command !== 'dev' && parsed.devRunner) {
    throw new Error('--runner is only supported for fluo dev. Use -- to forward --runner to the child command.');
  }
  const devRunner = command === 'dev' ? resolveDevRunnerPreference(parsed, env, projectRuntime) : 'fluo';
  assertStudioSupport(command, parsed.studio, projectRuntime, devRunner, rawWatch);
  const runnerSteps = buildProjectRunner(command, projectRuntime, parsed.passThrough, { devRunner, rawWatch });
  const reporterMode = resolveReporterMode(parsed, { ...runtime, env, stdout });
  const verbose = parsed.verbose || isEnabledEnvironmentFlag(env.FLUO_VERBOSE);
  let childEnv = withPipedReporterColorEnv(withProjectLocalBin(withDefaultNodeEnv(env, defaultNodeEnv), project.directory), reporterMode, stdout, stderr);

  if (parsed.studio && parsed.dryRun) {
    childEnv = withStudioDryRunEnv(childEnv, project, projectRuntime);
  }

  if (command === 'dev' && parsed.studio && !parsed.dryRun) {
    const studioSidecarFactory = runtime.startStudioSidecar ?? await loadDefaultStudioSidecarFactory();
    const studioSidecar = await studioSidecarFactory({
      appId: projectDisplayName(project),
      port: parsed.studioPort,
      runtime: projectRuntimeToStudioRuntime(projectRuntime),
    });
    childEnv = {
      ...childEnv,
      ...studioSidecar.env,
    };
    const studioUrl = `${studioSidecar.url}/?token=${encodeURIComponent(studioSidecar.token)}`;
    stdout.write(`[fluo] Studio listening at ${studioUrl}\n`);
    return await runScriptWithStudioSidecar(command, project.directory, projectRuntime, colorizeRunnerSteps(runnerSteps, childEnv), childEnv, runtime, reporterMode, verbose, stdout, stderr, studioSidecar);
  }

  const colorAwareRunnerSteps = colorizeRunnerSteps(runnerSteps, childEnv);

  if (command === 'dev' && (reporterMode === 'pretty' || verbose)) {
    childEnv[SHOW_NODE_RESTART_NOTICE_ENV] = '1';
  }

  if (parsed.dryRun) {
    for (const step of colorAwareRunnerSteps) {
      stdout.write(`Would run: ${step.command} ${step.args.join(' ')}\n`);
    }
    stdout.write(`Project: ${project.path}\n`);
    stdout.write(`Runtime: ${projectRuntime}\n`);
    stdout.write(`NODE_ENV: ${childEnv.NODE_ENV ?? ''}\n`);
    stdout.write(`Reporter: ${reporterMode}\n`);
    if (command === 'dev') {
      stdout.write(`Watch mode: ${colorAwareRunnerSteps.map((step) => step.mode ?? 'single-run').join(', ')}\n`);
      if (parsed.studio) {
        stdout.write('Studio: enabled (sidecar binds 127.0.0.1 at runtime)\n');
        stdout.write(`FLUO_STUDIO: ${childEnv.FLUO_STUDIO ?? ''}\n`);
        stdout.write(`FLUO_STUDIO_URL: ${childEnv.FLUO_STUDIO_URL ?? ''}\n`);
      }
    }
    return 0;
  }

  return await executeRunnerStepsWithReporter({
    childEnv,
    command,
    projectDirectory: project.directory,
    projectRuntime,
    reporterMode,
    runnerSteps: colorAwareRunnerSteps,
    runtime,
    stderr,
    stdout,
    verbose,
  });
}
