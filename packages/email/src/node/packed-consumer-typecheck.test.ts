import { expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceArtifactWriter } from '../../../../tooling/scripts/run-workspace-build-closure.mjs';

import { createPackedEmailConsumer } from './packed-consumer.fixture.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (...args: Parameters<typeof actual.spawnSync>) => {
      if (args[0] === 'npm' && args[1]?.[0] === 'pack') {
        return actual.spawnSync(
          process.execPath,
          ['-e', "process.stderr.write('npm error Exit handler never called!\\n'); process.exit(1);"],
          args[2],
        );
      }
      return actual.spawnSync(...args);
    },
  };
});

it(
  'imports the packed root without transport peers and typechecks Node consumers with optional or bundled types when npm packing is unavailable',
  async () => {
    const writer = createWorkspaceArtifactWriter(
      fileURLToPath(new URL('../../dist', import.meta.url)),
      fileURLToPath(new URL('../../../../', import.meta.url)),
      { timeoutMs: 180_000 },
    );
    let consumer: ReturnType<typeof createPackedEmailConsumer> | undefined;
    let installations: string | undefined;

    try {
      await writer.ready;
      consumer = createPackedEmailConsumer(() => {
        expect(writer.attempt()).toMatchObject({ event: 'blocked', pid: writer.child.pid });
        expect(writer.child.pid).not.toBe(process.pid);
      });
      // Workspace reads ended at the stable packed snapshot, before tarball typecheck.
      expect((await writer.exited)[0]).toBe(0);
      expect(writer.events).toEqual(['ready', 'attempt', 'blocked', 'completed']);
      expect(consumer.packedManifest.peerDependencies?.['@types/nodemailer']).toBe('^8.0.0');
      expect(consumer.packedManifest.peerDependenciesMeta?.['@types/nodemailer']?.optional).toBe(true);
      expect(consumer.compilerOptions.skipLibCheck).toBe(false);
      expect(consumer.typecheck()).toMatchObject({ status: 0 });

      installations = mkdtempSync(join(tmpdir(), 'fluo-email-install-matrix-'));
      const { dependencies }: { readonly dependencies: Readonly<Record<string, string>> } =
        JSON.parse(readFileSync(join(consumer.directory, 'package.json'), 'utf8'));
      const compilerConfig = {
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          strict: true,
          skipLibCheck: false,
          types: ['node'],
        },
        include: ['src/**/*.ts'],
      };
      const nodeExample = readFileSync(join(consumer.directory, 'src', 'index.ts'), 'utf8');
      // pnpm's Vitest shim injects workspace modules through NODE_PATH.
      const environment = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
      for (const scenario of ['root', 'bundled-types'] as const) {
        const directory = join(installations, scenario);
        const scenarioDependencies = Object.fromEntries(Object.entries(dependencies).filter(([name]) =>
          name !== '@types/nodemailer' && name !== '@fluojs/queue' && (scenario === 'bundled-types' || name !== 'nodemailer'),
        ));
        mkdirSync(directory);
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({ name: `email-${scenario}-consumer`, private: true, type: 'module', dependencies: scenarioDependencies }),
        );
        const install = spawnSync(
          'npm',
          ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
          { cwd: directory, env: environment, encoding: 'utf8', timeout: 180_000 },
        );
        expect(install.error).toBeUndefined();
        expect(install.status, `${scenario} install:\n${install.stdout}\n${install.stderr}`).toBe(0);

        if (scenario === 'root') {
          const imported = spawnSync(
            process.execPath,
            ['--input-type=module', '--eval', [
              "import assert from 'node:assert/strict';",
              "import { createRequire } from 'node:module';",
              "const requireEmail = createRequire(import.meta.resolve('@fluojs/email'));",
              "for (const peer of ['@fluojs/queue', 'nodemailer']) {",
              "  assert.throws(() => requireEmail.resolve(peer), { code: 'MODULE_NOT_FOUND' });",
              '}',
              "const { EmailService } = await import('@fluojs/email');",
              "assert.equal(typeof EmailService, 'function');",
            ].join('\n')],
            { cwd: directory, env: environment, encoding: 'utf8', timeout: 180_000 },
          );
          expect(imported.error).toBeUndefined();
          expect(imported.status, `root ESM import:\n${imported.stdout}\n${imported.stderr}`).toBe(0);
        } else {
          const installedPaths = readdirSync(join(directory, 'node_modules'), { recursive: true, encoding: 'utf8' });
          expect(
            installedPaths.filter((path) => /(^|\/)@types\/nodemailer(?:\/|$)/u.test(path)),
            'bundled-types consumer must not install @types/nodemailer anywhere in its tree',
          ).toEqual([]);
          writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(compilerConfig));
          mkdirSync(join(directory, 'src'));
          writeFileSync(join(directory, 'src', 'index.ts'), nodeExample);
          const compiled = spawnSync(
            process.execPath,
            [join(directory, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json'],
            { cwd: directory, env: environment, encoding: 'utf8', timeout: 180_000 },
          );
          expect(compiled.error).toBeUndefined();
          expect(compiled.status, `bundled-types compilation:\n${compiled.stdout}\n${compiled.stderr}`).toBe(0);
        }
      }
    } finally {
      if (installations) {
        rmSync(installations, { recursive: true, force: true });
      }
      consumer?.cleanup();
      await writer.stop();
    }
  },
  180_000,
);
