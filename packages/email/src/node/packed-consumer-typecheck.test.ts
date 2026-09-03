import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const packageRootPath = fileURLToPath(new URL('../..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../../..', import.meta.url));
const workspaceBuildClosurePath = resolve(repoRootPath, 'tooling/scripts/run-workspace-build-closure.mjs');
const commandTimeoutMs = 180_000;

interface PackedManifest {
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

function runCommand(command: string, args: readonly string[], cwd: string): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: commandTimeoutMs,
  });
}

function commandOutput(result: SpawnSyncReturns<string>): string {
  return [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
}

function expectCommandSuccess(result: SpawnSyncReturns<string>): void {
  expect(result.status, commandOutput(result)).toBe(0);
}

it(
  'typechecks the packed Node subpath in a clean consumer installation',
  () => {
    const sandboxPath = mkdtempSync(join(tmpdir(), 'fluo-email-clean-consumer-'));

    try {
      const tarballDirectory = join(sandboxPath, 'tarball');
      const consumerDirectory = join(sandboxPath, 'consumer');
      mkdirSync(tarballDirectory);
      mkdirSync(consumerDirectory);

      expectCommandSuccess(runCommand(process.execPath, [workspaceBuildClosurePath, '@fluojs/email'], repoRootPath));

      const packResult = runCommand(
        'pnpm',
        ['pack', '--json', '--pack-destination', tarballDirectory],
        packageRootPath,
      );
      expectCommandSuccess(packResult);

      const tarballName = readdirSync(tarballDirectory).find((entry) => entry.endsWith('.tgz'));
      expect(tarballName).toBeTruthy();

      const tarballPath = join(tarballDirectory, tarballName ?? '');
      const packedManifestResult = runCommand('tar', ['-xOf', tarballPath, 'package/package.json'], consumerDirectory);
      expectCommandSuccess(packedManifestResult);

      const packedManifest = JSON.parse(packedManifestResult.stdout) as PackedManifest;
      expect(packedManifest.peerDependencies?.['@types/nodemailer']).toBe('^8.0.0');
      expect(packedManifest.peerDependenciesMeta?.['@types/nodemailer']?.optional).toBe(true);

      writeFileSync(
        join(consumerDirectory, 'package.json'),
        `${JSON.stringify(
          {
            name: 'email-clean-consumer',
            private: true,
            type: 'module',
            dependencies: {
              '@fluojs/email': `file:${tarballPath}`,
              '@types/nodemailer': '8.0.0',
              nodemailer: '9.0.3',
              typescript: '6.0.2',
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(consumerDirectory, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              module: 'ESNext',
              moduleResolution: 'Bundler',
              noEmit: true,
              skipLibCheck: false,
              strict: true,
            },
            include: ['src/**/*.ts'],
          },
          null,
          2,
        )}\n`,
      );
      mkdirSync(join(consumerDirectory, 'src'));
      writeFileSync(
        join(consumerDirectory, 'src', 'index.ts'),
        "import type { NodemailerTransporter } from '@fluojs/email/node';\n\nexport type ConsumerTransporter = NodemailerTransporter;\n",
      );

      expectCommandSuccess(
        runCommand(
          'npm',
          ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
          consumerDirectory,
        ),
      );
      expectCommandSuccess(runCommand('npm', ['ls', '@types/nodemailer'], consumerDirectory));
      expectCommandSuccess(runCommand('npm', ['exec', '--', 'tsc', '--project', 'tsconfig.json'], consumerDirectory));
    } finally {
      rmSync(sandboxPath, { force: true, recursive: true });
    }
  },
  commandTimeoutMs,
);
