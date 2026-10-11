import { randomUUID } from 'node:crypto';
import { cpus, hostname, release } from 'node:os';
import type { GeneratorIdentity } from './load';
import { shoot, TrafficFailure, type TrafficOptions } from './traffic';

if (process.argv[2] === '--local-session') {
  const generator: GeneratorIdentity = {
    protocol: 'local-session-v1', pid: process.pid, nonce: randomUUID(),
    node: process.version, executable: process.execPath, hostname: hostname(),
  };
  let active = false;
  let initialized = false;
  let nextId = 0;
  process.on('disconnect', () => process.exit(0));
  process.on('message', async (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('id' in message)
      || message.id !== nextId || !('type' in message) || active) {
      throw new Error('Invalid or overlapping local load request');
    }
    nextId += 1;
    const id = message.id;
    if (message.type === 'init' && !initialized) {
      initialized = true;
      process.send?.({ id, payload: JSON.stringify(generator) });
      return;
    }
    if (message.type !== 'load' || !initialized || !('options' in message) || !('label' in message)
      || typeof message.label !== 'string') throw new Error('Invalid local load request');
    active = true;
    try {
      // Options originate in the owning runner, just as in the existing CLI.
      const options: TrafficOptions = JSON.parse(JSON.stringify(message.options));
      const measurement = await shoot(options, message.label);
      process.send?.({ id, payload: JSON.stringify({ ...measurement, generator }) });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      process.send?.({ id, payload: JSON.stringify({
        generator, failure: { message: error.message, ...(error instanceof TrafficFailure ? { diagnostics: error.diagnostics } : {}) },
      }) });
    } finally {
      active = false;
    }
  });
} else {
const options: TrafficOptions = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
try {
  const measurement = await shoot(options, 'remote-load-client');
  process.stdout.write(JSON.stringify({
    ...measurement,
    generator: { pid: process.pid, hostname: hostname(), node: process.version, osRelease: release(), cpus: cpus().map((cpu) => cpu.model) },
  }));
} catch (error) {
  if (!(error instanceof TrafficFailure)) throw error;
  process.stdout.write(JSON.stringify({ failure: { message: error.message, diagnostics: error.diagnostics } }));
  process.exitCode = 1;
}
}
