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
    `${JSON.stringify({
      exports: packageName === '@fluojs/microservices'
        ? {
            '.': './index.js',
            './kafka': './index.js',
            './nats': './index.js',
            './rabbitmq': './index.js',
          }
        : './index.js',
      name: packageName,
      type: 'module',
      version: '0.0.0-test',
    })}\n`,
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
  static create(options) {
    globalThis.__lastCreatedOptions = options;
    return new this(options);
  }
  setLogger(logger) {
    globalThis.__events.push('transport.setLogger');
    globalThis.__lastLogger = logger;
  }
  async close() {
    globalThis.__events.push('transport.close');
    if (globalThis.__delegatedCloseFails) {
      globalThis.__delegatedCloseError = new Error('delegated close failed');
      throw globalThis.__delegatedCloseError;
    }
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
  globalThis.__natsConnectEntered?.resolve();
  await globalThis.__natsConnectGate;
  if (globalThis.__natsConnectFails) {
    throw globalThis.__natsConnectError;
  }
  return {
    async close() {
      globalThis.__events.push('nats.connection.close');
      if (globalThis.__cleanupFails) throw new Error('nats cleanup failed');
    },
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
      async disconnect() {
        globalThis.__events.push('kafka.producer.disconnect');
        if (globalThis.__cleanupFails) throw new Error('producer cleanup failed');
      },
    };
  }
  consumer() {
    return {
      async connect() {
        globalThis.__events.push('kafka.consumer.connect');
        if (globalThis.__consumerConnectFails) {
          globalThis.__startupError = new Error('consumer connect failed');
          throw globalThis.__startupError;
        }
      },
      async disconnect() {
        globalThis.__events.push('kafka.consumer.disconnect');
        if (globalThis.__cleanupFails) throw new Error('consumer cleanup failed');
      },
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
    async close() {
      globalThis.__events.push('rabbitmq.connection.close');
      if (globalThis.__cleanupFails) throw new Error('connection cleanup failed');
    },
    async createConfirmChannel() {
      globalThis.__events.push('rabbitmq.channel.create');
      if (globalThis.__channelCreateFails) {
        globalThis.__startupError = new Error('channel creation failed');
        throw globalThis.__startupError;
      }
      return {
        async close() {
          globalThis.__events.push('rabbitmq.channel.close');
          if (globalThis.__channelCleanupFails) throw new Error('channel cleanup failed');
        },
        async assertQueue() {},
        async consume() { return { consumerTag: 'tag-1' }; },
      };
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

  it('aggregates NATS delegated and connection close failures', async () => {
    const projectDirectory = await generateBrokerStarter('nats');

    runAssertionScript(
      projectDirectory,
      `await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined);
globalThis.__delegatedCloseFails = true;
globalThis.__cleanupFails = true;
await transport.close().then(
  () => { throw new Error('Expected delegated close failure.'); },
  (error) => {
    const errors = Array.isArray(error.errors) ? error.errors : [];
    const messages = errors.map((cause) => cause?.message || String(cause));
    if (!messages.includes('delegated close failed') || !messages.includes('nats cleanup failed')) {
      throw new Error('NATS starter did not aggregate delegated and connection close errors: ' + messages.join(', '));
    }
  },
);
if (!globalThis.__events.includes('nats.connection.close')) {
  throw new Error('NATS connection cleanup was not attempted.');
}
`,
    );
  });

  it('preserves a concurrent NATS initialization failure when close waits for it', async () => {
    const projectDirectory = await generateBrokerStarter('nats');

    runAssertionScript(
      projectDirectory,
      `let rejectConnect;
globalThis.__natsConnectEntered = {};
globalThis.__natsConnectEntered.promise = new Promise((resolve) => { globalThis.__natsConnectEntered.resolve = resolve; });
globalThis.__natsConnectGate = new Promise((_resolve, reject) => { rejectConnect = reject; });
globalThis.__natsConnectFails = true;
globalThis.__natsConnectError = new Error('nats initialization failed');
await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
const starting = transport.listen(() => undefined);
await globalThis.__natsConnectEntered.promise;
const closing = transport.close();
rejectConnect(globalThis.__natsConnectError);
await starting.then(
  () => { throw new Error('Expected NATS initialization to fail.'); },
  (error) => {
    if (error !== globalThis.__natsConnectError) {
      throw new Error('NATS listen() did not preserve its initialization error.');
    }
  },
);
await closing.then(
  () => { throw new Error('Expected close() to preserve the concurrent initialization failure.'); },
  (error) => {
    if (error !== globalThis.__natsConnectError) {
      throw new Error('NATS close() suppressed the concurrent initialization error.');
    }
  },
);
`,
    );
  });

  it('aggregates Kafka connection and cleanup failures during initialization', async () => {
    const projectDirectory = await generateBrokerStarter('kafka');

    runAssertionScript(
      projectDirectory,
      `globalThis.__cleanupFails = true;
globalThis.__consumerConnectFails = true;
await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined).then(
  () => { throw new Error('Expected consumer connect failure.'); },
  (error) => {
    const errors = Array.isArray(error.errors) ? error.errors : [];
    const messages = errors.map((cause) => cause?.message || String(cause));
    for (const message of ['consumer connect failed', 'consumer cleanup failed', 'producer cleanup failed']) {
      if (!messages.includes(message)) {
        throw new Error('Kafka starter omitted "' + message + '" from initialization errors: ' + messages.join(', '));
      }
    }
  },
);
for (const event of ['kafka.consumer.disconnect', 'kafka.producer.disconnect']) {
  if (!globalThis.__events.includes(event)) throw new Error('Missing cleanup event: ' + event);
}
`,
    );
  });

  it('aggregates RabbitMQ channel creation and connection cleanup failures', async () => {
    const projectDirectory = await generateBrokerStarter('rabbitmq');

    runAssertionScript(
      projectDirectory,
      `globalThis.__channelCreateFails = true;
globalThis.__cleanupFails = true;
await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined).then(
  () => { throw new Error('Expected channel creation failure.'); },
  (error) => {
    const errors = Array.isArray(error.errors) ? error.errors : [];
    const messages = errors.map((cause) => cause?.message || String(cause));
    for (const message of ['channel creation failed', 'connection cleanup failed']) {
      if (!messages.includes(message)) {
        throw new Error('RabbitMQ starter omitted "' + message + '" from initialization errors: ' + messages.join(', '));
      }
    }
  },
);
if (!globalThis.__events.includes('rabbitmq.connection.close')) {
  throw new Error('RabbitMQ connection was not closed.');
}
`,
    );
  });

  it.each([
    ['kafka'],
    ['rabbitmq'],
  ] as const)('retries %s initialization after a failed owned-resource cleanup', async (transportName) => {
    const projectDirectory = await generateBrokerStarter(transportName);
    const failureSetup = transportName === 'kafka'
      ? 'globalThis.__consumerConnectFails = true; globalThis.__cleanupFails = true;'
      : 'globalThis.__channelCreateFails = true; globalThis.__cleanupFails = true;';

    runAssertionScript(
      projectDirectory,
      `${failureSetup}
await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined).then(
  () => { throw new Error('Expected first initialization to fail.'); },
  () => undefined,
);
globalThis.__consumerConnectFails = false;
globalThis.__channelCreateFails = false;
globalThis.__cleanupFails = false;
await transport.listen(() => undefined);
await transport.close();
`,
    );
  });

  it.each([
    ['nats'],
    ['kafka'],
    ['rabbitmq'],
  ] as const)('exposes ownsResources and granular resourceOwnership on %s wrapper', async (transportName) => {
    const projectDirectory = await generateBrokerStarter(transportName);

    runAssertionScript(
      projectDirectory,
      `await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
if (transport.ownsResources !== true) {
  throw new Error('Expected transport.ownsResources to be true, got: ' + transport.ownsResources);
}
if (!transport.resourceOwnership || transport.resourceOwnership.outboundClients !== 'framework' || transport.resourceOwnership.server !== 'framework') {
  throw new Error('Expected framework resourceOwnership, got: ' + JSON.stringify(transport.resourceOwnership));
}
`,
    );
  });

  it.each([
    ['nats'],
    ['kafka'],
    ['rabbitmq'],
  ] as const)('forwards setLogger to concrete %s transport before and after creation', async (transportName) => {
    const projectDirectory = await generateBrokerStarter(transportName);

    runAssertionScript(
      projectDirectory,
      `await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
const loggerA = { tag: 'logger-A' };
transport.setLogger(loggerA);
await transport.listen(() => undefined);
if (globalThis.__lastLogger !== loggerA) {
  throw new Error('Pre-creation logger was not forwarded to concrete transport.');
}
const loggerB = { tag: 'logger-B' };
transport.setLogger(loggerB);
if (globalThis.__lastLogger !== loggerB) {
  throw new Error('Post-creation logger was not forwarded to concrete transport.');
}
await transport.close();
`,
    );
  });

  it.each([
    ['nats', 'nats cleanup failed'],
    ['kafka', 'cleanup failed'],
    ['rabbitmq', 'connection cleanup failed'],
  ] as const)('surfaces broker cleanup failure on %s wrapper when delegated close succeeds', async (transportName, expectedMessage) => {
    const projectDirectory = await generateBrokerStarter(transportName);

    runAssertionScript(
      projectDirectory,
      `await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined);
globalThis.__cleanupFails = true;
let caughtError;
try {
  await transport.close();
} catch (err) {
  caughtError = err;
}
if (!caughtError) {
  throw new Error('Expected transport.close() to reject with cleanup failure.');
}
const msg = caughtError.message || String(caughtError);
const causes = Array.isArray(caughtError.errors) ? caughtError.errors.map((e) => e?.message || String(e)) : [];
const matches = msg.includes('${expectedMessage}') || causes.some((cause) => cause.includes('${expectedMessage}'));
if (!matches) {
  throw new Error('Expected error message or causes to contain "${expectedMessage}", got: ' + msg + '; causes: ' + causes.join(', '));
}
`,
    );
  });

  it('Kafka starter defaults to instance-scoped random response topic and accepts explicit env destination', async () => {
    const projectDirectory = await generateBrokerStarter('kafka');

    runAssertionScript(
      projectDirectory,
      `await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined);
if (globalThis.__lastCreatedOptions.responseTopic !== undefined) {
  throw new Error('Expected default responseTopic to be undefined, got: ' + globalThis.__lastCreatedOptions.responseTopic);
}
await transport.close();
`,
    );
  });

  it('RabbitMQ starter defaults to instance-scoped random response queue and accepts explicit env destination', async () => {
    const projectDirectory = await generateBrokerStarter('rabbitmq');

    runAssertionScript(
      projectDirectory,
      `await import(__MODULE_URL__);
const transport = globalThis.__fluoGeneratedTransport;
await transport.listen(() => undefined);
if (globalThis.__lastCreatedOptions.responseQueue !== undefined) {
  throw new Error('Expected default responseQueue to be undefined, got: ' + globalThis.__lastCreatedOptions.responseQueue);
}
await transport.close();
`,
    );
  });
});
