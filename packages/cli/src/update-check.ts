import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

type CliStream = {
  isTTY?: boolean;
  write(message: string): unknown;
};

type CliReadableStream = {
  isTTY?: boolean;
};

type UpdateCheckCache = {
  checkedAt: number;
  latestVersion: string;
};

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

export type CliUpdateCheckResult =
  | {
      action: 'continue';
    }
  | {
      action: 'reran';
      exitCode: number;
    };

export type UpdateInstallCommand = {
  args: string[];
  command: string;
  display: string;
};

export type UpdateCommandRuntime = {
  env: NodeJS.ProcessEnv;
  stderr: CliStream;
};

export type UpdatePrompter = {
  confirm(message: string, defaultValue: boolean): Promise<boolean>;
};

export interface CliUpdateCheckRuntimeOptions {
  cacheFile?: string;
  cacheTtlMs?: number;
  ci?: boolean;
  currentVersion?: string;
  env?: NodeJS.ProcessEnv;
  fetchLatestVersion?: (packageName: string) => Promise<string | undefined>;
  installPackage?: (installCommand: UpdateInstallCommand, runtime: UpdateCommandRuntime) => Promise<number>;
  interactive?: boolean;
  now?: () => Date;
  packageName?: string;
  prompt?: UpdatePrompter;
  rerunCli?: (argv: string[], runtime: UpdateCommandRuntime) => Promise<number>;
  skip?: boolean;
  stderr?: CliStream;
  stdin?: CliReadableStream;
  stdout?: CliStream;
}

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PACKAGE_NAME = '@fluojs/cli';
const DEFAULT_REGISTRY_TIMEOUT_MS = 5_000;
const UPDATE_CHECK_FLAGS = new Set(['--no-update-check', '--no-update-notifier']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function parseSemver(version: string): ParsedSemver | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());

  if (!match) {
    return undefined;
  }

  const [, major, minor, patch, prerelease] = match;
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

function compareNumericPart(left: number, right: number): number {
  if (left > right) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  return 0;
}

function comparePrereleaseIdentifier(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined) {
    return -1;
  }

  if (right === undefined) {
    return 1;
  }

  const leftNumber = /^\d+$/.test(left) ? Number.parseInt(left, 10) : undefined;
  const rightNumber = /^\d+$/.test(right) ? Number.parseInt(right, 10) : undefined;

  if (leftNumber !== undefined && rightNumber !== undefined) {
    return compareNumericPart(leftNumber, rightNumber);
  }

  if (leftNumber !== undefined) {
    return -1;
  }

  if (rightNumber !== undefined) {
    return 1;
  }

  if (left > right) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  return 0;
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  const major = compareNumericPart(left.major, right.major);
  if (major !== 0) {
    return major;
  }

  const minor = compareNumericPart(left.minor, right.minor);
  if (minor !== 0) {
    return minor;
  }

  const patch = compareNumericPart(left.patch, right.patch);
  if (patch !== 0) {
    return patch;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }

  if (left.prerelease.length === 0) {
    return 1;
  }

  if (right.prerelease.length === 0) {
    return -1;
  }

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const comparison = comparePrereleaseIdentifier(left.prerelease[index], right.prerelease[index]);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  const latest = parseSemver(latestVersion);
  const current = parseSemver(currentVersion);

  if (!latest || !current) {
    return false;
  }

  return compareSemver(latest, current) > 0;
}

function parseCache(contents: string): UpdateCheckCache | undefined {
  const parsed: unknown = JSON.parse(contents);

  if (!isRecord(parsed)) {
    return undefined;
  }

  const checkedAt = parsed.checkedAt;
  const latestVersion = parsed.latestVersion;

  if (typeof checkedAt !== 'number' || typeof latestVersion !== 'string') {
    return undefined;
  }

  return { checkedAt, latestVersion };
}

function resolveCacheFile(env: NodeJS.ProcessEnv): string {
  const cacheRoot = env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(cacheRoot, 'fluo', 'cli-update-check.json');
}

async function readCachedLatestVersion(cacheFile: string, nowMs: number, cacheTtlMs: number): Promise<string | undefined> {
  try {
    const cache = parseCache(await readFile(cacheFile, 'utf8'));
    if (!cache) {
      return undefined;
    }

    if (nowMs - cache.checkedAt > cacheTtlMs) {
      return undefined;
    }

    return cache.latestVersion;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return undefined;
    }

    return undefined;
  }
}

async function writeLatestVersionCache(cacheFile: string, latestVersion: string, nowMs: number): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify({ checkedAt: nowMs, latestVersion }, null, 2)}\n`, 'utf8');
}

async function fetchLatestDistTag(packageName: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REGISTRY_TIMEOUT_MS);

  try {
    const encodedPackageName = encodeURIComponent(packageName);
    const response = await fetch(`https://registry.npmjs.org/-/package/${encodedPackageName}/dist-tags`, {
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || typeof payload.latest !== 'string') {
      return undefined;
    }

    return payload.latest;
  } catch (_error: unknown) {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveLatestVersion(
  packageName: string,
  cacheFile: string,
  cacheTtlMs: number,
  nowMs: number,
  fetchLatestVersion: (packageName: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const cachedLatestVersion = await readCachedLatestVersion(cacheFile, nowMs, cacheTtlMs);
  if (cachedLatestVersion) {
    return cachedLatestVersion;
  }

  let latestVersion: string | undefined;
  try {
    latestVersion = await fetchLatestVersion(packageName);
  } catch (_error: unknown) {
    return undefined;
  }

  if (!latestVersion) {
    return undefined;
  }

  try {
    await writeLatestVersionCache(cacheFile, latestVersion, nowMs);
  } catch (_error: unknown) {
    return latestVersion;
  }

  return latestVersion;
}

async function readOwnPackageVersion(): Promise<string | undefined> {
  const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));

  try {
    const manifest: unknown = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    if (!isRecord(manifest) || typeof manifest.version !== 'string') {
      return undefined;
    }

    return manifest.version;
  } catch (_error: unknown) {
    return undefined;
  }
}

function resolveInstallCommand(packageName: string, latestVersion: string): UpdateInstallCommand {
  const packageSpecifier = `${packageName}@${latestVersion}`;

  return {
    args: ['add', '-g', packageSpecifier],
    command: 'pnpm',
    display: `pnpm add -g ${packageSpecifier}`,
  };
}

async function defaultPromptConfirm(message: string, defaultValue: boolean): Promise<boolean> {
  const promptSuffix = defaultValue ? 'Y/n' : 'y/N';
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await readline.question(`${message} (${promptSuffix}) `)).trim().toLowerCase();
    if (answer.length === 0) {
      return defaultValue;
    }

    return answer === 'y' || answer === 'yes';
  } finally {
    readline.close();
  }
}

async function defaultInstallPackage(installCommand: UpdateInstallCommand, runtime: UpdateCommandRuntime): Promise<number> {
  const result = spawnSync(installCommand.command, installCommand.args, {
    env: runtime.env,
    stdio: 'inherit',
  });

  if (result.error) {
    runtime.stderr.write(`Failed to run ${installCommand.display}: ${result.error.message}\n`);
    return 1;
  }

  return result.status ?? 1;
}

async function defaultRerunCli(argv: string[], runtime: UpdateCommandRuntime): Promise<number> {
  const command = process.platform === 'win32' ? 'fluo.cmd' : 'fluo';
  const result = spawnSync(command, argv, {
    env: {
      ...runtime.env,
      FLUO_UPDATE_CHECK_REEXEC: '1',
    },
    stdio: 'inherit',
  });

  if (result.error) {
    runtime.stderr.write(`Failed to restart fluo after updating: ${result.error.message}\n`);
    return 1;
  }

  return result.status ?? 1;
}

function shouldSkipForEnvironment(env: NodeJS.ProcessEnv, ci: boolean | undefined): boolean {
  return Boolean(ci)
    || isTruthyEnvValue(env.CI)
    || isTruthyEnvValue(env.GITHUB_ACTIONS)
    || isTruthyEnvValue(env.FLUO_NO_UPDATE_CHECK)
    || isTruthyEnvValue(env.NO_UPDATE_NOTIFIER)
    || isTruthyEnvValue(env.FLUO_UPDATE_CHECK_REEXEC)
    || Boolean(env.npm_lifecycle_event)
    || Boolean(env.npm_lifecycle_script);
}

function shouldRunInteractiveUpdateCheck(options: CliUpdateCheckRuntimeOptions, env: NodeJS.ProcessEnv): boolean {
  if (options.skip || options.interactive === false || shouldSkipForEnvironment(env, options.ci)) {
    return false;
  }

  return Boolean(options.stdin?.isTTY ?? process.stdin.isTTY)
    && Boolean(options.stdout?.isTTY ?? process.stdout.isTTY);
}

export function removeUpdateCheckFlags(argv: string[]): { argv: string[]; skipUpdateCheck: boolean } {
  const filteredArgv: string[] = [];
  let skipUpdateCheck = false;

  for (const arg of argv) {
    if (UPDATE_CHECK_FLAGS.has(arg)) {
      skipUpdateCheck = true;
      continue;
    }

    filteredArgv.push(arg);
  }

  return { argv: filteredArgv, skipUpdateCheck };
}

export async function runCliUpdateCheck(argv: string[], options: CliUpdateCheckRuntimeOptions = {}): Promise<CliUpdateCheckResult> {
  const env = options.env ?? {};
  const stderr = options.stderr ?? process.stderr;
  const stdout = options.stdout ?? process.stdout;

  if (!shouldRunInteractiveUpdateCheck({ ...options, stderr, stdout }, env)) {
    return { action: 'continue' };
  }

  const packageName = options.packageName ?? DEFAULT_PACKAGE_NAME;
  const now = options.now ?? (() => new Date());
  const nowMs = now().getTime();
  const cacheFile = options.cacheFile ?? resolveCacheFile(env);
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const currentVersion = options.currentVersion ?? await readOwnPackageVersion();

  if (!currentVersion) {
    return { action: 'continue' };
  }

  const latestVersion = await resolveLatestVersion(
    packageName,
    cacheFile,
    cacheTtlMs,
    nowMs,
    options.fetchLatestVersion ?? fetchLatestDistTag,
  );

  if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) {
    return { action: 'continue' };
  }

  stderr.write(`A newer ${packageName} version is available: ${currentVersion} -> ${latestVersion}.\n`);
  const prompt = options.prompt ?? { confirm: defaultPromptConfirm };
  const shouldInstall = await prompt.confirm(`Install ${packageName}@${latestVersion} now and restart this command?`, false);

  if (!shouldInstall) {
    stderr.write(`Continuing with ${packageName}@${currentVersion}.\n`);
    return { action: 'continue' };
  }

  const installCommand = resolveInstallCommand(packageName, latestVersion);
  stderr.write(`Installing ${packageName}@${latestVersion} with \`${installCommand.display}\`...\n`);

  const commandRuntime = { env, stderr };
  const installExitCode = await (options.installPackage ?? defaultInstallPackage)(installCommand, commandRuntime);
  if (installExitCode !== 0) {
    stderr.write(`Update install failed with exit code ${installExitCode}; continuing with ${packageName}@${currentVersion}.\n`);
    return { action: 'continue' };
  }

  stderr.write(`Updated ${packageName} to ${latestVersion}. Restarting fluo...\n`);
  const rerunExitCode = await (options.rerunCli ?? defaultRerunCli)(argv, {
    env: {
      ...env,
      FLUO_UPDATE_CHECK_REEXEC: '1',
    },
    stderr,
  });

  return {
    action: 'reran',
    exitCode: rerunExitCode,
  };
}
