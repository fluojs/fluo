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

  const script = readScript(project.manifest, command);
  if (!script) {
    throw new Error(`package.json does not define a "${command}" script.`);
  }

  const parsed = parseScriptArgs(argv);
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
