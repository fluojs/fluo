import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, it } from 'vitest';
import { scaffoldBootstrapApp } from './scaffold.js';

type BrokerTransport = 'kafka' | 'nats' | 'rabbitmq';

const require = createRequire(import.meta.url);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function writeStubPackage(projectDirectory: string, packageName: string, source: string): void {
  const packageDirectory = join(projectDirectory, 'node_modules', ...packageName.split('/'));
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(packageDirectory, 'package.json'),
    `${JSON.stringify({ exports: './index.js', name: packageName, type: 'module', version: '0.0.0-test' })}\n`,
    'utf8',
  );
  writeFileSync(join(packageDirectory, 'index.js'), source, 'utf8');
}

function installCommonStubs(projectDirectory: string): void {
  writeStubPackage(projectDirectory, '@fluojs/core', 'export function Module() { return () => undefined; }\n');
  writeStubPackage(
    projectDirectory,
    '@fluojs/config',
    'export class ConfigModule { static forRoot() { return class ConfigModuleDefinition {}; } }\n',
  );
  writeStubPackage(
    projectDirectory,
    '@fluojs/microservices',
    `export function MessagePattern() { return () => undefined; }
class BrokerTransport {
  async close() {
    globalThis.__events.push('transport.close');
    if (globalThis.__delegatedCloseFails) throw new Error('delegated close failed');
  }
  async emit() {}
  async listen() {}
  async send() {}
}
export class KafkaMicroserviceTransport extends BrokerTransport {}
export class NatsMicroserviceTransport extends BrokerTransport {}
export class RabbitMqMicroserviceTransport extends BrokerTransport {}
export class MicroservicesModule {
  static forRoot(options) {
    globalThis.__fluoGeneratedTransport = options.transport;
    return class MicroservicesModuleDefinition {};
  }
}
`,
  );
}

function installBrokerStub(projectDirectory: string, transport: BrokerTransport): void {
  if (transport === 'nats') {
    writeStubPackage(
      projectDirectory,
      'nats',
      `export function JSONCodec() { return { decode(value) { return value; }, encode(value) { return value; } }; }
export async function connect() {
  return {
    async close() { globalThis.__events.push('nats.connection.close'); },
    publish() {}, request() {}, subscribe() {},
  };
}
`,
    );
    return;
  }

  if (transport === 'kafka') {
    writeStubPackage(
      projectDirectory,
      'kafkajs',
      `export const logLevel = { NOTHING: 0 };
export class Kafka {
  producer() {
    return {
      async connect() { globalThis.__events.push('kafka.producer.connect'); },
      async disconnect() { globalThis.__events.push('kafka.producer.disconnect'); },
    };
  }
  consumer() {
    return {
      async connect() {
        globalThis.__events.push('kafka.consumer.connect');
        if (globalThis.__consumerConnectFails) throw new Error('consumer connect failed');
      },
      async disconnect() { globalThis.__events.push('kafka.consumer.disconnect'); },
    };
  }
}
`,
    );
    return;
  }

  writeStubPackage(
    projectDirectory,
    'amqplib',
    `export async function connect() {
  return {
    async close() { globalThis.__events.push('rabbitmq.connection.close'); },
    async createConfirmChannel() {
      globalThis.__events.push('rabbitmq.channel.create');
      if (globalThis.__channelCreateFails) throw new Error('channel creation failed');
      return { async close() { globalThis.__events.push('rabbitmq.channel.close'); } };
    },
  };
}
`,
  );
}

async function generateBrokerStarter(transport: BrokerTransport): Promise<string> {
  const targetDirectory = mkdtempSync(join(tmpdir(), `fluo-scaffold-cleanup-${transport}-`));
  temporaryDirectories.push(targetDirectory);

  await scaffoldBootstrapApp({
    packageManager: 'pnpm',
    platform: 'none',
    projectName: `starter-${transport}`,
    runtime: 'node',
    shape: 'microservice',
    skipInstall: true,
    targetDirectory,
    tooling: 'standard',
    topology: { deferred: true, mode: 'single-package' },
    transport,
  });
  installCommonStubs(targetDirectory);
  installBrokerStub(targetDirectory, transport);
  return targetDirectory;
}

function runAssertionScript(projectDirectory: string, source: string): void {
  const scriptPath = join(projectDirectory, 'assert-cleanup.mjs');
  const moduleUrl = pathToFileURL(join(projectDirectory, 'src', 'app.ts')).href;
  writeFileSync(scriptPath, `globalThis.__events = [];\n${source.replace('__MODULE_URL__', JSON.stringify(moduleUrl))}`, 'utf8');
  execFileSync(process.execPath, ['--import', require.resolve('tsx'), scriptPath], {
    cwd: projectDirectory,
    stdio: 'pipe',
  });
}

describe('generated broker starter cleanup', () => {
  it.each([
    ['nats', ['nats.connection.close']],
    ['kafka', ['kafka.consumer.disconnect', 'kafka.producer.disconnect']],
    ['rabbitmq', ['rabbitmq.channel.close', 'rabbitmq.connection.close']],
  ] as const)('cleans up owned %s clients when delegated close fails', async (transport, expectedEvents) => {
    const projectDirectory = await generateBrokerStarter(transport);

    runAssertionScript(
      projectDirectory,
      `const imported = await import(__MODULE_URL__);
if (typeof imported.AppModule !== 'function') throw new Error('AppModule was not exported.');
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined);
globalThis.__delegatedCloseFails = true;
await transport.close().then(
  () => { throw new Error('Expected delegated close failure.'); },
  () => undefined,
);
for (const event of ${JSON.stringify(expectedEvents)}) {
  if (!globalThis.__events.includes(event)) throw new Error('Missing cleanup event: ' + event);
}
`,
    );
  });

  it('disconnects both Kafka clients when one connect fails', async () => {
    const projectDirectory = await generateBrokerStarter('kafka');

    runAssertionScript(
      projectDirectory,
      `globalThis.__consumerConnectFails = true;
await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined).then(
  () => { throw new Error('Expected consumer connect failure.'); },
  () => undefined,
);
for (const event of ['kafka.consumer.disconnect', 'kafka.producer.disconnect']) {
  if (!globalThis.__events.includes(event)) throw new Error('Missing cleanup event: ' + event);
}
`,
    );
  });

  it('closes the RabbitMQ connection when channel creation fails', async () => {
    const projectDirectory = await generateBrokerStarter('rabbitmq');

    runAssertionScript(
      projectDirectory,
      `globalThis.__channelCreateFails = true;
await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined).then(
  () => { throw new Error('Expected channel creation failure.'); },
  () => undefined,
);
if (!globalThis.__events.includes('rabbitmq.connection.close')) {
  throw new Error('RabbitMQ connection was not closed.');
}
`,
    );
  });
});
