import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type CliStream = {
  write(message: string): unknown;
};

type DiagnosticRuntimeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchDistTags?: (packageName: string) => Promise<Record<string, string> | undefined>;
  stdout?: CliStream;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_PACKAGE_NAME = '@fluojs/cli';
const DEFAULT_REGISTRY_TIMEOUT_MS = 5_000;
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

function readCliVersion(): string {
  const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const manifest = readJsonFile(packageJsonPath);
  return typeof manifest?.version === 'string' ? manifest.version : 'unknown';
}

function resolveCacheFile(env: NodeJS.ProcessEnv): string {
  const cacheRoot = env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(cacheRoot, 'fluo', 'cli-update-check.json');
}

function readUpdateCache(env: NodeJS.ProcessEnv): { ageMs?: number; checkedAt?: string; latestVersion?: string; path: string } {
  const cacheFile = resolveCacheFile(env);
  const cache = readJsonFile(cacheFile);
  const checkedAt = typeof cache?.checkedAt === 'number' ? cache.checkedAt : undefined;

  return {
    ageMs: checkedAt === undefined ? undefined : Date.now() - checkedAt,
    checkedAt: checkedAt === undefined ? undefined : new Date(checkedAt).toISOString(),
    latestVersion: typeof cache?.latestVersion === 'string' ? cache.latestVersion : undefined,
    path: cacheFile,
  };
}

function findProjectManifest(startDirectory: string): { manifest?: JsonRecord; path?: string } {
  let current = resolve(startDirectory);

  while (true) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      return { manifest: readJsonFile(candidate), path: candidate };
    }

    const parent = dirname(current);
    if (parent === current) {
      return {};
    }

    current = parent;
  }
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
    if (!isRecord(payload)) {
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

function formatAge(ageMs: number | undefined): string {
  if (ageMs === undefined) {
    return 'unknown';
  }

  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function listScripts(manifest: JsonRecord | undefined): string[] {
  const scripts = manifest?.scripts;
  if (!isRecord(scripts)) {
    return [];
  }

  return Object.keys(scripts).sort();
}

export function diagnosticsUsage(command: 'analyze' | 'doctor' | 'info' = 'doctor'): string {
  if (command === 'analyze') {
    return [
      'Usage: fluo analyze [options]',
      '',
      'Summarize the current project and point to deeper inspect/report diagnostics.',
      '',
      'Options',
      '  --help  Show help for the analyze command.',
    ].join('\n');
  }

  return [
    `Usage: fluo ${command} [options]`,
    '',
    'Print CLI, registry, update-cache, runtime, and project diagnostics.',
    '',
    'Options',
    `  --help  Show help for the ${command} command.`,
  ].join('\n');
}

export async function runDoctorCommand(argv: string[], runtime: DiagnosticRuntimeOptions = {}): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    (runtime.stdout ?? process.stdout).write(`${diagnosticsUsage('doctor')}\n`);
    return 0;
  }

  if (argv.length > 0) {
    throw new Error(`Unknown doctor option: ${argv[0]}`);
  }

  const env = runtime.env ?? EMPTY_ENV;
  const stdout = runtime.stdout ?? process.stdout;
  const cwd = resolve(runtime.cwd ?? process.cwd());
  const cache = readUpdateCache(env);
  const distTags = await (runtime.fetchDistTags ?? fetchNpmDistTags)(DEFAULT_PACKAGE_NAME);
  const project = findProjectManifest(cwd);
  const scripts = listScripts(project.manifest);

  stdout.write('fluo doctor\n');
  stdout.write(`  CLI version: ${readCliVersion()}\n`);
  stdout.write(`  Node.js: ${process.version}\n`);
  stdout.write(`  Platform: ${process.platform}/${process.arch}\n`);
  stdout.write(`  Package manager signal: ${env.npm_config_user_agent ?? 'unknown'}\n`);
  stdout.write(`  npm latest: ${distTags?.latest ?? 'unavailable'}\n`);
  stdout.write(`  npm beta: ${distTags?.beta ?? 'unavailable'}\n`);
  stdout.write(`  Update cache: ${cache.path}\n`);
  stdout.write(`  Cached latest: ${cache.latestVersion ?? 'none'}\n`);
  stdout.write(`  Cache checked: ${cache.checkedAt ?? 'never'} (${formatAge(cache.ageMs)} ago)\n`);
  stdout.write(`  Project manifest: ${project.path ?? 'not found'}\n`);
  stdout.write(`  Project scripts: ${scripts.length > 0 ? scripts.join(', ') : 'none'}\n`);

  return 0;
}

export async function runInfoCommand(argv: string[], runtime: DiagnosticRuntimeOptions = {}): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    (runtime.stdout ?? process.stdout).write(`${diagnosticsUsage('info')}\n`);
    return 0;
  }

  return runDoctorCommand(argv, runtime);
}

export async function runAnalyzeCommand(argv: string[], runtime: DiagnosticRuntimeOptions = {}): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    (runtime.stdout ?? process.stdout).write(`${diagnosticsUsage('analyze')}\n`);
    return 0;
  }

  if (argv.length > 0) {
    throw new Error(`Unknown analyze option: ${argv[0]}`);
  }

  const stdout = runtime.stdout ?? process.stdout;
  const cwd = resolve(runtime.cwd ?? process.cwd());
  const project = findProjectManifest(cwd);
  const scripts = listScripts(project.manifest);

  stdout.write('fluo analyze\n');
  stdout.write(`  Project manifest: ${project.path ?? 'not found'}\n`);
  stdout.write(`  Available scripts: ${scripts.length > 0 ? scripts.join(', ') : 'none'}\n`);
  stdout.write('  Deep inspection: run `fluo inspect <module-path> --report --output <file>` for runtime graph diagnostics.\n');
  stdout.write('  Migration preview: run `fluo migrate <path> --json` for codemod diagnostics.\n');

  return 0;
}
