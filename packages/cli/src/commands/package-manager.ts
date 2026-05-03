import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type JsonRecord = Record<string, unknown>;

export const SUPPORTED_PACKAGE_MANAGERS = new Set(['bun', 'npm', 'pnpm', 'yarn']);

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

function packageManagerFromManifest(manifest: JsonRecord): string | undefined {
  const packageManager = manifest.packageManager;
  if (typeof packageManager !== 'string') {
    return undefined;
  }

  const manager = packageManager.split('@')[0];
  return manager && SUPPORTED_PACKAGE_MANAGERS.has(manager) ? manager : undefined;
}

function packageManagerFromLockfile(directory: string): string | undefined {
  if (existsSync(join(directory, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(directory, 'bun.lockb')) || existsSync(join(directory, 'bun.lock'))) {
    return 'bun';
  }
  if (existsSync(join(directory, 'yarn.lock'))) {
    return 'yarn';
  }
  if (existsSync(join(directory, 'package-lock.json')) || existsSync(join(directory, 'npm-shrinkwrap.json'))) {
    return 'npm';
  }

  return undefined;
}

function packageManagerFromUserAgent(env: NodeJS.ProcessEnv): string | undefined {
  const userAgentName = env.npm_config_user_agent?.split(' ')[0]?.split('/')[0];
  return userAgentName && SUPPORTED_PACKAGE_MANAGERS.has(userAgentName) ? userAgentName : undefined;
}

export function detectPackageManager(options: { cwd: string; env: NodeJS.ProcessEnv; manifest?: JsonRecord }): string {
  const startDirectory = resolve(options.cwd);
  let current = startDirectory;

  while (true) {
    const manifestPath = join(current, 'package.json');
    const manifest = current === startDirectory && options.manifest ? options.manifest : existsSync(manifestPath) ? readJsonFile(manifestPath) : undefined;
    const manifestManager = manifest ? packageManagerFromManifest(manifest) : undefined;
    if (manifestManager) {
      return manifestManager;
    }

    const lockfileManager = packageManagerFromLockfile(current);
    if (lockfileManager) {
      return lockfileManager;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return packageManagerFromUserAgent(options.env) ?? 'pnpm';
}
