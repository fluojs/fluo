import { spawn } from 'node:child_process';
import { detectPackageManager, SUPPORTED_PACKAGE_MANAGERS } from './package-manager.js';

type CliStream = {
  write(message: string): unknown;
};

type PackageWorkflowRuntimeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchDistTags?: (packageName: string) => Promise<Record<string, string> | undefined>;
  spawnCommand?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }) => Promise<number>;
  stdout?: CliStream;
};

const DEFAULT_PACKAGE_NAME = '@fluojs/cli';
const DEFAULT_REGISTRY_TIMEOUT_MS = 5_000;
const EMPTY_ENV: NodeJS.ProcessEnv = {};

function normalizeFluoPackage(packageName: string): string {
  if (packageName.startsWith('@fluojs/')) {
    return packageName;
  }

  return `@fluojs/${packageName}`;
}

function buildAddArgs(packageManager: string, packages: string[], dev: boolean): string[] {
  if (packageManager === 'npm') {
    return ['install', dev ? '--save-dev' : '--save', ...packages];
  }

  if (packageManager === 'yarn') {
    return ['add', ...(dev ? ['--dev'] : []), ...packages];
  }

  return ['add', ...(dev ? ['-D'] : []), ...packages];
}

function defaultSpawnCommand(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }): Promise<number> {
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(command, args, options);
    child.on('error', reject);
    child.on('exit', (code) => resolveExitCode(code ?? 1));
  });
}

async function fetchNpmDistTags(packageName: string): Promise<Record<string, string> | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REGISTRY_TIMEOUT_MS);

  try {
    const response = await fetch(`https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      return undefined;
    }

    const distTags: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        distTags[key] = value;
      }
    }

    return distTags;
  } catch (_error: unknown) {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function parsePackageManager(value: string | undefined): string {
  if (!value || value.startsWith('-')) {
    throw new Error('Expected --package-manager to have a value.');
  }

  if (!SUPPORTED_PACKAGE_MANAGERS.has(value)) {
    throw new Error(`Invalid --package-manager value "${value}". Use one of: pnpm, npm, yarn, bun.`);
  }

  return value;
}

export function addUsage(): string {
  return [
    'Usage: fluo add <package...> [options]',
    '',
    'Install one or more @fluojs packages with the detected package manager.',
    '',
    'Options',
    '  --dev                                 Install as a development dependency.',
    '  --package-manager <pnpm|npm|yarn|bun> Override package-manager detection.',
    '  --dry-run                             Print the command without running it.',
    '  --help                                Show help for the add command.',
  ].join('\n');
}

export function upgradeUsage(): string {
  return [
    'Usage: fluo upgrade [options]',
    '',
    'Report the latest CLI package state and point to migration workflows.',
    '',
    'Options',
    '  --help  Show help for the upgrade command.',
  ].join('\n');
}

export async function runAddCommand(argv: string[], runtime: PackageWorkflowRuntimeOptions = {}): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    (runtime.stdout ?? process.stdout).write(`${addUsage()}\n`);
    return 0;
  }

  let dev = false;
  let dryRun = false;
  let packageManager: string | undefined;
  const packages: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dev' || arg === '-D') {
      dev = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--package-manager') {
      packageManager = parsePackageManager(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown add option: ${arg}`);
    }
    packages.push(normalizeFluoPackage(arg));
  }

  if (packages.length === 0) {
    throw new Error('Expected at least one package for fluo add.');
  }

  const env = runtime.env ?? EMPTY_ENV;
  const manager = packageManager ?? detectPackageManager({ cwd: runtime.cwd ?? process.cwd(), env });
  const args = buildAddArgs(manager, packages, dev);

  if (dryRun) {
    (runtime.stdout ?? process.stdout).write(`Would run: ${manager} ${args.join(' ')}\n`);
    return 0;
  }

  return (runtime.spawnCommand ?? defaultSpawnCommand)(manager, args, {
    cwd: runtime.cwd ?? process.cwd(),
    env,
    stdio: 'inherit',
  });
}

export async function runUpgradeCommand(argv: string[], runtime: PackageWorkflowRuntimeOptions = {}): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    (runtime.stdout ?? process.stdout).write(`${upgradeUsage()}\n`);
    return 0;
  }

  if (argv.length > 0) {
    throw new Error(`Unknown upgrade option: ${argv[0]}`);
  }

  const distTags = await (runtime.fetchDistTags ?? fetchNpmDistTags)(DEFAULT_PACKAGE_NAME);
  const stdout = runtime.stdout ?? process.stdout;
  stdout.write('fluo upgrade\n');
  stdout.write(`  Latest CLI: ${distTags?.latest ?? 'unavailable'}\n`);
  stdout.write('  To update the global CLI, run your package manager global install command for @fluojs/cli@latest.\n');
  stdout.write('  To preview NestJS migration codemods, run `fluo migrate <path> --json`.\n');
  stdout.write('  To inspect generated starter drift, run `fluo doctor`.\n');
  return 0;
}
