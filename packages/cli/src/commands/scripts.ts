import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { detectPackageManager, SUPPORTED_PACKAGE_MANAGERS } from './package-manager.js';

type CliStream = {
  write(message: string): unknown;
};

type ScriptRuntimeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnCommand?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }) => Promise<number>;
  stdout?: CliStream;
};

type JsonRecord = Record<string, unknown>;
type ScriptCommand = 'build' | 'dev' | 'start';
type ProjectRuntime = 'bun' | 'cloudflare-workers' | 'deno' | 'node';

const EMPTY_ENV: NodeJS.ProcessEnv = {};

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

function readScript(manifest: JsonRecord, scriptName: string): string | undefined {
  const scripts = manifest.scripts;
  if (!isRecord(scripts)) {
    return undefined;
  }

  const script = scripts[scriptName];
  return typeof script === 'string' ? script : undefined;
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

function buildRunArgs(packageManager: string, scriptName: string, passThrough: string[]): string[] {
  if (packageManager === 'npm') {
    return ['run', scriptName, ...(passThrough.length > 0 ? ['--', ...passThrough] : [])];
  }

  if (packageManager === 'yarn') {
    return [scriptName, ...passThrough];
  }

  return ['run', scriptName, ...passThrough];
}

function defaultSpawnCommand(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }): Promise<number> {
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(command, args, options);
    child.on('error', reject);
    child.on('exit', (code) => resolveExitCode(code ?? 1));
  });
}

function buildProjectRunner(command: Extract<ScriptCommand, 'dev' | 'start'>, runtime: ProjectRuntime, passThrough: string[]): { args: string[]; command: string } {
  if (command === 'dev') {
    switch (runtime) {
      case 'bun':
        return { command: 'bun', args: ['--watch', 'src/main.ts', ...passThrough] };
      case 'deno':
        return { command: 'deno', args: ['run', '--allow-env', '--allow-net', '--watch', 'src/main.ts', ...passThrough] };
      case 'cloudflare-workers':
        return { command: 'wrangler', args: ['dev', ...passThrough] };
      default:
        return { command: 'node', args: ['--env-file=.env', '--watch', '--watch-preserve-output', '--import', 'tsx', 'src/main.ts', ...passThrough] };
    }
  }

  switch (runtime) {
    case 'bun':
      return { command: 'bun', args: ['dist/main.js', ...passThrough] };
    case 'deno':
      return { command: join('dist', 'app'), args: [...passThrough] };
    case 'cloudflare-workers':
      return { command: 'wrangler', args: ['deploy', ...passThrough] };
    default:
      return { command: 'node', args: ['dist/main.js', ...passThrough] };
  }
}

function parseScriptArgs(argv: string[]): { dryRun: boolean; packageManager?: string; passThrough: string[] } {
  let dryRun = false;
  let packageManager: string | undefined;
  const passThrough: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      dryRun = true;
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

  return { dryRun, packageManager, passThrough };
}

export function scriptUsage(command: ScriptCommand): string {
  if (command === 'dev' || command === 'start') {
    const nodeEnv = command === 'dev' ? 'development' : 'production';
    return [
      `Usage: fluo ${command} [options] [-- <args>]`,
      '',
      `Run the generated fluo project ${command} lifecycle with NODE_ENV defaulting to ${nodeEnv} when unset.`,
      '',
      'Options',
      '  --dry-run                              Print the command without running it.',
      `  --help                                 Show help for the ${command} command.`,
    ].join('\n');
  }

  return [
    `Usage: fluo ${command} [options] [-- <args>]`,
    '',
    `Run the project package.json \`${command}\` script through the detected package manager.`,
    '',
    'Options',
    '  --package-manager <pnpm|npm|yarn|bun>  Override package-manager detection.',
    '  --dry-run                              Print the command without running it.',
    `  --help                                 Show help for the ${command} command.`,
  ].join('\n');
}

export async function runScriptCommand(command: ScriptCommand, argv: string[], runtime: ScriptRuntimeOptions = {}): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    (runtime.stdout ?? process.stdout).write(`${scriptUsage(command)}\n`);
    return 0;
  }

  const env = runtime.env ?? EMPTY_ENV;
  const stdout = runtime.stdout ?? process.stdout;
  const project = findProjectManifest(runtime.cwd ?? process.cwd());
  if (!project) {
    throw new Error(`Unable to find package.json for fluo ${command}.`);
  }

  const parsed = parseScriptArgs(argv);

  if (command === 'dev' || command === 'start') {
    const projectRuntime = detectProjectRuntime(project.manifest);
    const defaultNodeEnv = command === 'dev' ? 'development' : 'production';
    const childEnv = withDefaultNodeEnv(env, defaultNodeEnv);
    const runner = buildProjectRunner(command, projectRuntime, parsed.passThrough);

    if (parsed.dryRun) {
      stdout.write(`Would run: ${runner.command} ${runner.args.join(' ')}\n`);
      stdout.write(`Project: ${project.path}\n`);
      stdout.write(`Runtime: ${projectRuntime}\n`);
      stdout.write(`NODE_ENV: ${childEnv.NODE_ENV ?? ''}\n`);
      return 0;
    }

    return (runtime.spawnCommand ?? defaultSpawnCommand)(runner.command, runner.args, {
      cwd: project.directory,
      env: childEnv,
      stdio: 'inherit',
    });
  }

  const script = readScript(project.manifest, command);
  if (!script) {
    throw new Error(`package.json does not define a "${command}" script.`);
  }

  const packageManager = parsed.packageManager ?? detectPackageManager({ cwd: project.directory, env, manifest: project.manifest });
  const args = buildRunArgs(packageManager, command, parsed.passThrough);

  if (parsed.dryRun) {
    stdout.write(`Would run: ${packageManager} ${args.join(' ')}\n`);
    stdout.write(`Project: ${project.path}\n`);
    stdout.write(`Script: ${script}\n`);
    return 0;
  }

  return (runtime.spawnCommand ?? defaultSpawnCommand)(packageManager, args, {
    cwd: project.directory,
    env,
    stdio: 'inherit',
  });
}
