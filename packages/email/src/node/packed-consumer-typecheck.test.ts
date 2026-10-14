import { expect, it, vi } from 'vitest';
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
  'typechecks the packed Node subpath in a clean consumer installation when npm packing is unavailable',
  async () => {
    const writer = createWorkspaceArtifactWriter(
      fileURLToPath(new URL('../../dist', import.meta.url)),
      fileURLToPath(new URL('../../../../', import.meta.url)),
      { timeoutMs: 180_000 },
    );
    let consumer: ReturnType<typeof createPackedEmailConsumer> | undefined;

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
    } finally {
      consumer?.cleanup();
      await writer.stop();
    }
  },
  180_000,
);
