import { expect, it } from 'vitest';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import { createPackedEmailConsumer } from './packed-consumer.fixture.js';

it(
  'typechecks the packed Node subpath in a clean consumer installation',
  async () => {
    const state = new Int32Array(new SharedArrayBuffer(4));
    const cleanUrl = new URL('../../../../tooling/scripts/clean-dist.mjs', import.meta.url);
    const writer = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const state = new Int32Array(workerData.buffer);
      const wait = Atomics.wait;
      Atomics.wait = (...args) => {
        Atomics.store(state, 0, 1);
        Atomics.notify(state, 0);
        return wait(...args);
      };
      parentPort.once('message', async () => {
        process.argv[1] = require('node:url').fileURLToPath(workerData.cleanUrl);
        process.argv[2] = workerData.dist;
        await import(workerData.cleanUrl);
        Atomics.store(state, 0, 2);
        Atomics.notify(state, 0);
        parentPort.close();
      });
    `, { eval: true, workerData: {
      buffer: state.buffer, cleanUrl: cleanUrl.href,
      dist: fileURLToPath(new URL('../../dist', import.meta.url)),
    } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    const exited = once(writer, 'exit', { signal: controller.signal });
    void exited.catch(() => {});
    let consumer: ReturnType<typeof createPackedEmailConsumer> | undefined;

    try {
      consumer = createPackedEmailConsumer(() => {
        writer.postMessage('attempt-clean');
        expect(Atomics.wait(state, 0, 0, 10_000)).not.toBe('timed-out');
        expect(Atomics.load(state, 0)).toBe(1);
      });
      // Workspace reads ended at the stable packed snapshot, before tarball typecheck.
      expect((await exited)[0]).toBe(0);
      expect(Atomics.load(state, 0)).toBe(2);
      expect(consumer.packedManifest.peerDependencies?.['@types/nodemailer']).toBe('^8.0.0');
      expect(consumer.packedManifest.peerDependenciesMeta?.['@types/nodemailer']?.optional).toBe(true);
      expect(consumer.compilerOptions.skipLibCheck).toBe(false);
      expect(consumer.typecheck()).toMatchObject({ status: 0 });
    } finally {
      clearTimeout(timer);
      consumer?.cleanup();
      await writer.terminate();
    }
  },
  180_000,
);
