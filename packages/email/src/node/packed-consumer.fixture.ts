/// <reference types="node" />

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const packageRootPath = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const repoRootPath = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const workspaceBuildClosurePath = resolve(repoRootPath, 'tooling/scripts/run-workspace-build-closure.mjs');
const commandTimeoutMs = 180_000;
const tarBlockSize = 512;
const consumerDependencyNames = [
  '@fluojs/core',
  '@fluojs/di',
  '@fluojs/notifications',
  '@fluojs/runtime',
  '@fluojs/config',
  '@fluojs/http',
  '@fluojs/validation',
  '@standard-schema/spec',
  'validator',
  'nodemailer',
  '@types/nodemailer',
  '@types/node',
  'undici-types',
  'typescript',
] as const;

interface PackedManifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

/** Hermetic packed-package consumer used to verify the published Node declaration closure. */
export interface PackedEmailConsumer {
  readonly compilerOptions: Readonly<{ readonly skipLibCheck: false }>;
  readonly packedManifest: PackedManifest;
  cleanup(): void;
  typecheck(): SpawnSyncReturns<string>;
}

function runCommand(command: string, args: readonly string[], cwd: string): SpawnSyncReturns<string> {
  return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: commandTimeoutMs });
}

function expectCommandSuccess(command: string, result: SpawnSyncReturns<string>): void {
  if (result.status === 0) {
    return;
  }

  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
  throw new Error(`${command} failed with status ${result.status ?? 'unknown'}.\n${output}`);
}

function tarString(buffer: Buffer): string {
  const terminator = buffer.indexOf(0);
  return buffer.subarray(0, terminator === -1 ? buffer.length : terminator).toString('utf8');
}

function readPackedManifest(tarballPath: string): PackedManifest {
  const archive = gunzipSync(readFileSync(tarballPath));
  const headerOffset = archive.indexOf('package/package.json\0', 0, 'utf8');
  if (headerOffset < 0 || headerOffset % tarBlockSize !== 0) {
    throw new Error(`Packed archive ${tarballPath} does not contain package/package.json.`);
  }

  const header = archive.subarray(headerOffset, headerOffset + tarBlockSize);
  const size = Number.parseInt(tarString(header.subarray(124, 136)).trim(), 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Invalid package manifest size in ${tarballPath}.`);
  }

  const contentStart = headerOffset + tarBlockSize;
  const contentEnd = contentStart + size;
  if (contentEnd > archive.length) {
    throw new Error(`Truncated package manifest in ${tarballPath}.`);
  }

  return JSON.parse(archive.subarray(contentStart, contentEnd).toString('utf8')) as PackedManifest;
}

function resolveInstalledPackage(packageName: string, fromDirectory: string): string {
  if (packageName.startsWith('@fluojs/')) {
    const workspacePackage = join(repoRootPath, 'packages', packageName.slice('@fluojs/'.length));
    if (existsSync(join(workspacePackage, 'package.json'))) {
      return workspacePackage;
    }
  }

  for (let directory = fromDirectory; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', ...packageName.split('/'));
    if (existsSync(join(candidate, 'package.json'))) {
      return realpathSync(candidate);
    }

    if (directory === repoRootPath) {
      break;
    }
  }

  const hoistedPackage = join(repoRootPath, 'node_modules', '.pnpm', 'node_modules', ...packageName.split('/'));
  if (existsSync(join(hoistedPackage, 'package.json'))) {
    return realpathSync(hoistedPackage);
  }

  throw new Error(`Could not resolve ${packageName} from ${fromDirectory}.`);
}

function packPackage(packageDirectory: string, tarballDirectory: string): string {
  const existingArchives = new Set(readdirSync(tarballDirectory));
  const packed = runCommand('pnpm', ['pack', '--json', '--pack-destination', tarballDirectory], packageDirectory);
  expectCommandSuccess(`pnpm pack in ${packageDirectory}`, packed);
  const filename = readdirSync(tarballDirectory).find((entry) => entry.endsWith('.tgz') && !existingArchives.has(entry));
  if (!filename) {
    throw new Error(`pnpm pack did not report an archive for ${packageDirectory}.`);
  }

  return join(tarballDirectory, filename);
}

function addPackedDependency(
  packageName: string,
  packageDirectory: string,
  tarballDirectory: string,
  archives: Record<string, string>,
): void {
  archives[packageName] = `file:${packPackage(packageDirectory, tarballDirectory)}`;
}

/**
 * Creates an offline consumer from locally packed workspace dependencies.
 *
 * @returns A disposable consumer fixture with its packed manifest and typecheck command.
 */
export function createPackedEmailConsumer(): PackedEmailConsumer {
  const sandboxPath = mkdtempSync(join(tmpdir(), 'fluo-email-clean-consumer-'));

  try {
    const tarballDirectory = join(sandboxPath, 'tarball');
    const consumerDirectory = join(sandboxPath, 'consumer');
    mkdirSync(tarballDirectory);
    mkdirSync(consumerDirectory);
    expectCommandSuccess(
      'workspace build closure',
      runCommand(process.execPath, [workspaceBuildClosurePath, '@fluojs/email'], repoRootPath),
    );

    const archives: Record<string, string> = {};
    const emailTarballPath = packPackage(packageRootPath, tarballDirectory);
    const packedManifest = readPackedManifest(emailTarballPath);
    archives[packedManifest.name] = `file:${emailTarballPath}`;
    for (const dependencyName of consumerDependencyNames) {
      addPackedDependency(dependencyName, resolveInstalledPackage(dependencyName, packageRootPath), tarballDirectory, archives);
    }

    const compilerOptions = {
      module: 'ESNext',
      moduleResolution: 'Bundler',
      noEmit: true,
      skipLibCheck: false,
      strict: true,
    } as const;
    writeFileSync(
      join(consumerDirectory, 'package.json'),
      `${JSON.stringify({ name: 'email-clean-consumer', private: true, type: 'module', dependencies: archives }, null, 2)}\n`,
    );
    writeFileSync(join(consumerDirectory, 'tsconfig.json'), `${JSON.stringify({ compilerOptions, include: ['src/**/*.ts'] }, null, 2)}\n`);
    mkdirSync(join(consumerDirectory, 'src'));
    writeFileSync(
      join(consumerDirectory, 'src', 'index.ts'),
      "import type { NodemailerTransporter } from '@fluojs/email/node';\n\nexport type ConsumerTransporter = NodemailerTransporter;\n",
    );

    expectCommandSuccess(
      'offline clean consumer install',
      runCommand('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], consumerDirectory),
    );
    expectCommandSuccess('clean consumer Nodemailer types', runCommand('npm', ['ls', '@types/nodemailer'], consumerDirectory));

    return {
      compilerOptions,
      packedManifest,
      cleanup: () => rmSync(sandboxPath, { force: true, recursive: true }),
      typecheck: () => {
        const result = runCommand(process.execPath, [join(consumerDirectory, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json'], consumerDirectory);
        expectCommandSuccess('packed consumer typecheck', result);
        return result;
      },
    };
  } catch (error) {
    rmSync(sandboxPath, { force: true, recursive: true });
    throw error;
  }
}
