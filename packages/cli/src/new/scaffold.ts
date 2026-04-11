import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeGitRepository, installDependencies } from './install.js';
import { resolveBootstrapPlan, type ResolvedBootstrapPlan } from './resolver.js';
import type { StarterScaffoldRecipeId } from './starter-profiles.js';
import type { BootstrapOptions, PackageManager } from './types.js';

const PACKAGE_DIRECTORY_BY_NAME = {
  '@fluojs/platform-bun': 'platform-bun',
  '@fluojs/cli': 'cli',
  '@fluojs/config': 'config',
  '@fluojs/core': 'core',
  '@fluojs/di': 'di',
  '@fluojs/http': 'http',
  '@fluojs/platform-cloudflare-workers': 'platform-cloudflare-workers',
  '@fluojs/platform-deno': 'platform-deno',
  '@fluojs/microservices': 'microservices',
  '@fluojs/platform-express': 'platform-express',
  '@fluojs/platform-fastify': 'platform-fastify',
  '@fluojs/platform-nodejs': 'platform-nodejs',
  '@fluojs/runtime': 'runtime',
  '@fluojs/testing': 'testing',
  '@fluojs/validation': 'validation',
} as const;

const PUBLISHED_DEV_DEPENDENCIES = {
  '@babel/cli': '^7.26.4',
  '@babel/core': '^7.26.10',
  '@babel/plugin-proposal-decorators': '^7.28.0',
  '@babel/preset-typescript': '^7.27.1',
  '@types/babel__core': '^7.20.5',
  '@types/node': '^22.13.10',
  tsx: '^4.20.4',
  typescript: '^6.0.2',
  vite: '^6.2.1',
  vitest: '^3.0.8',
} as const;

const PUBLISHED_RUNTIME_DEPENDENCIES = {
  '@types/amqplib': '^0.10.7',
  '@grpc/grpc-js': '^1.0.0',
  '@grpc/proto-loader': '^0.8.0',
  amqplib: '^0.10.5',
  ioredis: '^5.0.0',
  kafkajs: '^2.2.4',
  mqtt: '^5.0.0',
  nats: '^2.29.3',
} as const;

type LocalPackageName = keyof typeof PACKAGE_DIRECTORY_BY_NAME;

type ApplicationStarterDescriptor = {
  adapterCall?: string;
  adapterFactory?: string;
  entrypoint: 'src/main.ts' | 'src/worker.ts';
  packageName?: '@fluojs/platform-bun' | '@fluojs/platform-cloudflare-workers' | '@fluojs/platform-deno' | '@fluojs/platform-express' | '@fluojs/platform-fastify' | '@fluojs/platform-nodejs';
  platformLabel: string;
  runtimeLabel: string;
};

function describeApplicationStarter(options: Pick<BootstrapOptions, 'platform' | 'runtime'>): ApplicationStarterDescriptor {
  if (options.runtime === 'bun') {
    return {
      adapterCall: 'createBunAdapter({ port })',
      adapterFactory: 'createBunAdapter',
      entrypoint: 'src/main.ts',
      packageName: '@fluojs/platform-bun',
      platformLabel: 'Bun native HTTP',
      runtimeLabel: 'Bun runtime',
    };
  }

  if (options.runtime === 'deno') {
    return {
      entrypoint: 'src/main.ts',
      packageName: '@fluojs/platform-deno',
      platformLabel: 'Deno native HTTP',
      runtimeLabel: 'Deno runtime',
    };
  }

  if (options.runtime === 'cloudflare-workers') {
    return {
      entrypoint: 'src/worker.ts',
      packageName: '@fluojs/platform-cloudflare-workers',
      platformLabel: 'Cloudflare Workers HTTP',
      runtimeLabel: 'Cloudflare Workers runtime',
    };
  }

  switch (options.platform) {
    case 'express':
      return {
        adapterCall: 'createExpressAdapter({ port })',
        adapterFactory: 'createExpressAdapter',
        entrypoint: 'src/main.ts',
        packageName: '@fluojs/platform-express',
        platformLabel: 'Express HTTP',
        runtimeLabel: 'Node.js runtime',
      };
    case 'nodejs':
      return {
        adapterCall: 'createNodejsAdapter({ port })',
        adapterFactory: 'createNodejsAdapter',
        entrypoint: 'src/main.ts',
        packageName: '@fluojs/platform-nodejs',
        platformLabel: 'raw Node.js HTTP',
        runtimeLabel: 'Node.js runtime',
      };
    default:
      return {
        adapterCall: 'createFastifyAdapter({ port })',
        adapterFactory: 'createFastifyAdapter',
        entrypoint: 'src/main.ts',
        packageName: '@fluojs/platform-fastify',
        platformLabel: 'Fastify HTTP',
        runtimeLabel: 'Node.js runtime',
      };
  }
}

const LOCAL_PACKAGE_CACHE_DIR = join(tmpdir(), 'fluo-cli-local-packages');
const LOCAL_PACKAGE_CACHE_STAMP_FILE = 'cache-stamp.json';

type LocalPackageCacheStamp = {
  dirtyFingerprint: string;
  headCommit: string;
  packageVersions: Partial<Record<LocalPackageName, string>>;
};

function packageRootFromImportMeta(importMetaUrl: string): string {
  return resolve(dirname(fileURLToPath(importMetaUrl)), '..', '..');
}

function readOwnPackageVersion(importMetaUrl: string): string {
  const packageJson = JSON.parse(readFileSync(join(packageRootFromImportMeta(importMetaUrl), 'package.json'), 'utf8')) as {
    version: string;
  };

  return packageJson.version;
}

function writeTextFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function createDependencySpec(
  packageName: string,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): string {
  return packageSpecs[packageName]
    ?? PUBLISHED_RUNTIME_DEPENDENCIES[packageName as keyof typeof PUBLISHED_RUNTIME_DEPENDENCIES]
    ?? `^${releaseVersion}`;
}

function createRunCommand(packageManager: PackageManager, command: string): string {
  switch (packageManager) {
    case 'bun':
      return `bun run ${command}`;
    case 'npm':
      return `npm run ${command}`;
    case 'yarn':
      return `yarn ${command}`;
    default:
      return `pnpm ${command}`;
  }
}

function createExecCommand(packageManager: PackageManager, command: string): string {
  switch (packageManager) {
    case 'bun':
      return `bun x ${command}`;
    case 'npm':
      return `npm exec -- ${command}`;
    case 'yarn':
      return `yarn ${command}`;
    default:
      return `pnpm exec ${command}`;
  }
}

function createProjectScripts(bootstrapPlan: ResolvedBootstrapPlan): Record<string, string> {
  switch (bootstrapPlan.profile.id) {
    case 'application-bun-bun-http':
      return {
        build: 'bun build ./src/main.ts --outdir ./dist --target bun',
        dev: 'bun --watch src/main.ts',
        test: 'vitest run',
        'test:watch': 'vitest',
        typecheck: 'tsc -p tsconfig.json --noEmit',
      };
    case 'application-deno-deno-http':
      return {
        build: 'mkdir -p dist && deno compile --allow-env --allow-net --output dist/app src/main.ts',
        dev: 'deno run --allow-env --allow-net --watch src/main.ts',
        test: 'deno test --allow-env --allow-net',
        'test:watch': 'deno test --allow-env --allow-net --watch',
        typecheck: 'deno check src/main.ts src/app.test.ts',
      };
    case 'application-cloudflare-workers-cloudflare-workers-http':
      return {
        build: 'wrangler deploy --dry-run',
        dev: 'wrangler dev',
        test: 'vitest run',
        'test:watch': 'vitest',
        typecheck: 'tsc -p tsconfig.json --noEmit',
      };
    default:
      return {
        build: 'babel src --extensions .ts --out-dir dist --config-file ./babel.config.cjs && tsc -p tsconfig.build.json',
        dev: 'node --env-file=.env --watch --watch-preserve-output --import tsx src/main.ts',
        test: 'vitest run',
        'test:watch': 'vitest',
        typecheck: 'tsc -p tsconfig.json --noEmit',
      };
  }
}

function createProjectEngines(bootstrapPlan: ResolvedBootstrapPlan): Record<string, string> {
  switch (bootstrapPlan.profile.id) {
    case 'application-bun-bun-http':
      return { bun: '>=1.2.5' };
    case 'application-deno-deno-http':
      return { deno: '>=2.0.0' };
    default:
      return { node: '>=20.0.0' };
  }
}

function createPublishedDevDependencies(bootstrapPlan: ResolvedBootstrapPlan): Record<string, string> {
  if (bootstrapPlan.profile.id === 'application-deno-deno-http') {
    return {};
  }

  if (bootstrapPlan.profile.id === 'application-cloudflare-workers-cloudflare-workers-http') {
    return {
      ...PUBLISHED_DEV_DEPENDENCIES,
      wrangler: '^4.11.1',
    };
  }

  return { ...PUBLISHED_DEV_DEPENDENCIES };
}

function createProjectPackageJson(
  options: BootstrapOptions,
  bootstrapPlan: ResolvedBootstrapPlan,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): string {
  const packageManagerField = options.packageManager === 'pnpm'
    ? { packageManager: 'pnpm@10.4.1' }
    : options.packageManager === 'bun'
      ? { packageManager: 'bun@1.2.5' }
    : options.packageManager === 'yarn'
      ? { packageManager: 'yarn@1.22.22' }
      : {};
  const localOverrideConfig = Object.keys(packageSpecs).length
    ? {
        overrides: packageSpecs,
        resolutions: packageSpecs,
      }
    : {};

  const dependencyEntries = Object.fromEntries(
    bootstrapPlan.dependencies.dependencies.map((packageName) => [
      packageName,
      createDependencySpec(packageName, releaseVersion, packageSpecs),
    ]),
  );
  const devDependencyEntries = Object.fromEntries(
    bootstrapPlan.dependencies.devDependencies.map((packageName) => [
      packageName,
      createDependencySpec(packageName, releaseVersion, packageSpecs),
    ]),
  );

  return JSON.stringify(
    {
      name: options.projectName,
      version: '0.1.0',
      private: true,
      type: 'module',
      engines: createProjectEngines(bootstrapPlan),
      ...packageManagerField,
      ...localOverrideConfig,
      scripts: createProjectScripts(bootstrapPlan),
      dependencies: dependencyEntries,
      devDependencies: {
        ...devDependencyEntries,
        ...createPublishedDevDependencies(bootstrapPlan),
      },
    },
    null,
    2,
  );
}

function createProjectTsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
`;
}

function createProjectTsconfigBuild(): string {
  return `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist"
  },
  "exclude": ["src/**/*.test.ts"]
}
`;
}

function createBabelConfig(): string {
  return `module.exports = {
  ignore: ['src/**/*.test.ts'],
  presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
  plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
};
`;
}

function createViteConfig(): string {
  return `import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
  },
});
`;
}

function createVitestConfig(): string {
  return `import { defineConfig } from 'vitest/config';

import { fluoBabelDecoratorsPlugin } from '@fluojs/testing/vitest';

export default defineConfig({
  plugins: [fluoBabelDecoratorsPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
`;
}

function createGitignore(): string {
  return `node_modules
dist
.fluo
.env
.env.local
.wrangler
.dev.vars
coverage
`;
}

function createHttpProjectReadme(options: BootstrapOptions): string {
  const starter = describeApplicationStarter(options);
  const entrypointLabel = starter.entrypoint;
  const starterContract = options.runtime === 'deno'
    ? `\`${entrypointLabel}\` boots the selected first-class application starter: ${starter.runtimeLabel} + ${starter.platformLabel} via \`runDenoApplication(...)\``
    : options.runtime === 'cloudflare-workers'
      ? `\`${entrypointLabel}\` exports the selected first-class application starter: ${starter.runtimeLabel} + ${starter.platformLabel} via \`createCloudflareWorkerEntrypoint(...)\``
      : `\`${entrypointLabel}\` wires the selected first-class application starter: ${starter.runtimeLabel} + ${starter.platformLabel} via \`${starter.adapterFactory}(... )\``.replace('(... )', '(...)');
  const corsLine = options.runtime === 'cloudflare-workers'
    ? '- CORS: defaults to allowOrigin `*`; pass a `cors` option to `createCloudflareWorkerEntrypoint(..., { cors })` when you need edge-specific restrictions'
    : options.runtime === 'deno'
      ? '- CORS: defaults to allowOrigin `*`; configure it through the Deno HTTP bootstrap path before exposing the adapter in production'
      : `- CORS: defaults to allowOrigin '*'; pass a \`cors\` option to \`FluoFactory.create(..., { cors, adapter: ${starter.adapterFactory}(...) })\` to restrict origins`;
  const testingSection = options.runtime === 'deno'
    ? `## Official generated testing templates\n\n- \`src/app.test.ts\` — Deno-native integration-style dispatch verification for the generated runtime + starter routes.\n\nUse this test when you need confidence that the generated Deno entrypoint and module graph still agree on the same HTTP contract.`
    : `## Official generated testing templates\n\n- \`src/health/*.test.ts\` — unit templates for the starter-owned health slice.\n- \`src/app.test.ts\` — integration-style dispatch template for runtime + starter routes.\n- \`src/app.e2e.test.ts\` — e2e-style template powered by \`createTestApp\` from \`@fluojs/testing\`.\n- \`${createExecCommand(options.packageManager, 'fluo g repo User')}\` also adds:\n  - \`src/users/user.repo.test.ts\` (unit template)\n  - \`src/users/user.repo.slice.test.ts\` (slice/integration template via \`createTestingModule\`)\n\nUse unit templates for fast logic checks. Use slice/e2e templates when you need module wiring and route-level confidence.`;

  return `# ${options.projectName}

Generated by @fluojs/cli.

- Starter contract: ${starterContract}
- Default baseline: when you omit \`--platform\`, \`fluo new\` still generates the Node.js + Fastify HTTP starter by default
- Broader runtime/adapter package coverage is documented in the fluo docs and package READMEs; this generated starter intentionally describes only the wired starter path above
- Package manager: install/run commands can use ${options.packageManager}; runtime choice stays explicit and is independent from the package manager you picked
- Runtime dependency set: generated manifest entries match the selected runtime contract instead of inheriting the Node-only starter recipe
${corsLine}
- Observability: /health and /ready endpoints are included by default
- Runtime path: bootstrapApplication -> handler mapping -> dispatcher -> middleware -> guard -> interceptor -> controller
- Naming policy: runtime module entrypoints use governed canonical names (\`forRoot(...)\`, optional \`forRootAsync(...)\`, \`register(...)\`, \`forFeature(...)\`); helper/builders stay \`create*\` (for example \`createHealthModule()\`, \`createTestingModule(...)\`)

## Commands

- Dev: ${createRunCommand(options.packageManager, 'dev')}
- Build: ${createRunCommand(options.packageManager, 'build')}
- Typecheck: ${createRunCommand(options.packageManager, 'typecheck')}
- Test: ${createRunCommand(options.packageManager, 'test')}

## Generator example

- Repo generator: ${createExecCommand(options.packageManager, 'fluo g repo User')}

${testingSection}
`;
}

type MicroserviceStarterDescriptor = {
  configLines: readonly string[];
  entrypointNote: string;
  extraFiles?: readonly string[];
  generatedProjectVerification: string;
  packageManagerNote: string;
  pattern: string;
  readmeTransportLabel: string;
  runtimeDependencyNote: string;
  starterNote: string;
  testNote: string;
};

function describeMicroserviceStarter(options: Pick<BootstrapOptions, 'transport'>): MicroserviceStarterDescriptor {
  switch (options.transport) {
    case 'redis-streams':
      return {
        configLines: [
          '- Redis Streams broker: configure `REDIS_URL` in `.env` before you start the service',
          '- Optional stream tuning: `REDIS_STREAMS_NAMESPACE` and `REDIS_STREAMS_CONSUMER_GROUP` let you align stream names and the consumer group with your broker contract',
        ],
        entrypointNote: '`src/app.ts` wires `RedisStreamsMicroserviceTransport` with dedicated reader/writer `ioredis` clients configured for lazy connection startup',
        generatedProjectVerification: 'The generated-project verification path typechecks, builds, and tests the scaffold while asserting the Redis Streams starter keeps the `ioredis` dependency, `.env` contract, and transport entrypoint wiring intact.',
        packageManagerNote: 'runtime choice stays explicit and independent from the package manager you picked; the generated manifest adds the `ioredis` dependency because Redis Streams transport support lives outside the base fluo packages',
        pattern: 'math.sum',
        readmeTransportLabel: 'redis-streams',
        runtimeDependencyNote: 'runtime dependency set: `@fluojs/microservices` plus `ioredis` for the broker client pair used by `RedisStreamsMicroserviceTransport`',
        starterNote: 'the Redis Streams starter keeps TCP as the default microservice path when you omit `--transport`, but this scaffold becomes runnable as soon as `REDIS_URL` points at a broker',
        testNote: '`src/app.test.ts` preserves a broker-free integration template via an in-memory transport, while generated-project verification still checks the Redis Streams entrypoint/build contract.',
      };
    case 'mqtt':
      return {
        configLines: [
          '- MQTT broker: configure `MQTT_URL` in `.env` before you start the service',
          '- Topic namespace: adjust `MQTT_NAMESPACE` when you need transport-owned topics to coexist with other services on the same broker',
        ],
        entrypointNote: '`src/app.ts` wires `MqttMicroserviceTransport` with the generated broker URL and namespace settings so the starter can own its MQTT client at runtime',
        generatedProjectVerification: 'The generated-project verification path typechecks, builds, and tests the scaffold while asserting the MQTT starter keeps the `mqtt` dependency, `.env` contract, and transport entrypoint wiring intact.',
        packageManagerNote: 'runtime choice stays explicit and independent from the package manager you picked; the generated manifest adds the `mqtt` dependency because MQTT transport support lives outside the base fluo packages',
        pattern: 'math.sum',
        readmeTransportLabel: 'mqtt',
        runtimeDependencyNote: 'runtime dependency set: `@fluojs/microservices` plus `mqtt` for the broker client that `MqttMicroserviceTransport` loads at runtime',
        starterNote: 'the MQTT starter keeps TCP as the default microservice path when you omit `--transport`, but this scaffold becomes runnable as soon as `MQTT_URL` points at a broker',
        testNote: '`src/app.test.ts` preserves a broker-free integration template via an in-memory transport, while generated-project verification still checks the MQTT entrypoint/build contract.',
      };
    case 'grpc':
      return {
        configLines: [
          '- gRPC listener: configure `GRPC_URL` in `.env` before you start the service',
          '- Protobuf contract: `proto/math.proto` stays in the generated project root and `src/app.ts` resolves it from `process.cwd()` so builds and runtime launches share the same schema path',
        ],
        entrypointNote: '`src/app.ts` wires `GrpcMicroserviceTransport` against `proto/math.proto`, the `fluo.microservices` package, and the generated `MathService` RPC contract',
        extraFiles: ['- `proto/math.proto` — protobuf contract for the generated `MathService.Sum` RPC'],
        generatedProjectVerification: 'The generated-project verification path typechecks, builds, and tests the scaffold while asserting the gRPC starter keeps the protobuf file, gRPC peer dependencies, `.env` contract, and transport entrypoint wiring intact.',
        packageManagerNote: 'runtime choice stays explicit and independent from the package manager you picked; the generated manifest adds `@grpc/grpc-js` and `@grpc/proto-loader` because gRPC transport support lives outside the base fluo packages',
        pattern: 'MathService.Sum',
        readmeTransportLabel: 'grpc',
        runtimeDependencyNote: 'runtime dependency set: `@fluojs/microservices` plus `@grpc/grpc-js` and `@grpc/proto-loader` for the generated protobuf-backed RPC listener',
        starterNote: 'the gRPC starter keeps TCP as the default microservice path when you omit `--transport`, but this scaffold becomes runnable as soon as `GRPC_URL` is reachable for the generated protobuf contract',
        testNote: '`src/app.test.ts` preserves a broker-free integration template via an in-memory transport, while generated-project verification still checks the gRPC entrypoint/build contract and the generated `proto/math.proto` file.',
      };
    case 'nats':
      return {
        configLines: [
          '- NATS broker: configure `NATS_SERVERS` in `.env` before you start the service',
          '- Subject contract: keep `NATS_MESSAGE_SUBJECT` and `NATS_EVENT_SUBJECT` aligned with the peer services that share the broker namespace',
        ],
        entrypointNote: '`src/app.ts` opens one caller-owned `nats` client plus `JSONCodec()` and passes both into `NatsMicroserviceTransport` as the canonical starter bootstrap contract',
        generatedProjectVerification: 'The generated-project verification path typechecks, builds, and tests the scaffold while asserting the NATS starter keeps the `nats` dependency, `.env` contract, and transport entrypoint wiring intact.',
        packageManagerNote: 'runtime choice stays explicit and independent from the package manager you picked; the generated manifest adds the `nats` client because the NATS starter depends on an external broker plus a caller-owned client/bootstrap pair',
        pattern: 'math.sum',
        readmeTransportLabel: 'nats',
        runtimeDependencyNote: 'runtime dependency set: `@fluojs/microservices` plus `nats` for the broker client and codec that `NatsMicroserviceTransport` expects the caller to supply',
        starterNote: 'the NATS starter keeps TCP as the default microservice path when you omit `--transport`, but this scaffold becomes runnable as soon as `NATS_SERVERS` points at a reachable broker cluster',
        testNote: '`src/app.test.ts` preserves a broker-free integration template via an in-memory transport, while generated-project verification still checks the NATS entrypoint/build contract and the caller-owned client bootstrap wiring.',
      };
    case 'kafka':
      return {
        configLines: [
          '- Kafka brokers: configure `KAFKA_BROKERS` in `.env` before you start the service',
          '- Topic/group contract: `KAFKA_CLIENT_ID`, `KAFKA_CONSUMER_GROUP`, `KAFKA_MESSAGE_TOPIC`, `KAFKA_EVENT_TOPIC`, and `KAFKA_RESPONSE_TOPIC` stay explicit so the starter never hides its shared broker topology',
        ],
        entrypointNote: '`src/app.ts` opens canonical `kafkajs` producer/consumer collaborators and passes them into `KafkaMicroserviceTransport`, keeping the response-topic contract explicit in starter-owned config',
        generatedProjectVerification: 'The generated-project verification path typechecks, builds, and tests the scaffold while asserting the Kafka starter keeps the `kafkajs` dependency, `.env` contract, and transport entrypoint wiring intact.',
        packageManagerNote: 'runtime choice stays explicit and independent from the package manager you picked; the generated manifest adds `kafkajs` because the Kafka starter depends on an external broker plus caller-owned producer/consumer collaborators',
        pattern: 'math.sum',
        readmeTransportLabel: 'kafka',
        runtimeDependencyNote: 'runtime dependency set: `@fluojs/microservices` plus `kafkajs` for the generated producer/consumer/bootstrap contract used by `KafkaMicroserviceTransport`',
        starterNote: 'the Kafka starter keeps TCP as the default microservice path when you omit `--transport`, but this scaffold becomes runnable as soon as `KAFKA_BROKERS` points at a reachable broker set',
        testNote: '`src/app.test.ts` preserves a broker-free integration template via an in-memory transport, while generated-project verification still checks the Kafka entrypoint/build contract and the explicit topic/client bootstrap wiring.',
      };
    case 'rabbitmq':
      return {
        configLines: [
          '- RabbitMQ broker: configure `RABBITMQ_URL` in `.env` before you start the service',
          '- Queue contract: `RABBITMQ_MESSAGE_QUEUE`, `RABBITMQ_EVENT_QUEUE`, and `RABBITMQ_RESPONSE_QUEUE` stay explicit so the starter advertises exactly which queues and reply path it owns',
        ],
        entrypointNote: '`src/app.ts` opens a canonical `amqplib` connection/channel pair and passes caller-owned publisher/consumer collaborators into `RabbitMqMicroserviceTransport`',
        generatedProjectVerification: 'The generated-project verification path typechecks, builds, and tests the scaffold while asserting the RabbitMQ starter keeps the `amqplib` dependency, `.env` contract, and transport entrypoint wiring intact.',
        packageManagerNote: 'runtime choice stays explicit and independent from the package manager you picked; the generated manifest adds `amqplib` because the RabbitMQ starter depends on an external broker plus caller-owned publisher/consumer collaborators',
        pattern: 'math.sum',
        readmeTransportLabel: 'rabbitmq',
        runtimeDependencyNote: 'runtime dependency set: `@fluojs/microservices`, `amqplib`, and `@types/amqplib` for the generated queue client/bootstrap contract used by `RabbitMqMicroserviceTransport`',
        starterNote: 'the RabbitMQ starter keeps TCP as the default microservice path when you omit `--transport`, but this scaffold becomes runnable as soon as `RABBITMQ_URL` points at a reachable broker',
        testNote: '`src/app.test.ts` preserves a broker-free integration template via an in-memory transport, while generated-project verification still checks the RabbitMQ entrypoint/build contract and the explicit queue/bootstrap wiring.',
      };
    default:
      return {
        configLines: ['- Local TCP listener: configure `MICROSERVICE_HOST` and `MICROSERVICE_PORT` in `.env`'],
        entrypointNote: '`src/app.ts` wires `TcpMicroserviceTransport` directly with the generated host/port environment settings',
        generatedProjectVerification: 'The generated-project verification path typechecks, builds, and tests the scaffold while asserting the TCP starter keeps the default `.env` contract and transport entrypoint wiring intact.',
        packageManagerNote: 'transport choice stays explicit and is independent from the package manager you picked',
        pattern: 'math.sum',
        readmeTransportLabel: 'tcp',
        runtimeDependencyNote: 'runtime dependency set: `@fluojs/microservices` with no extra transport peer dependencies beyond the base fluo packages',
        starterNote: 'TCP remains the simplest default microservice path when you omit `--transport`.',
        testNote: '`src/app.test.ts` preserves a broker-free integration template via an in-memory transport that matches the generated message pattern contract.',
      };
  }
}

function createMicroserviceResponseExpectation(options: Pick<BootstrapOptions, 'transport'>): string {
  return options.transport === 'grpc' ? '{ result: 42 }' : '42';
}

function createMicroserviceProjectReadme(options: BootstrapOptions): string {
  const starter = describeMicroserviceStarter(options);
  const extraFilesSection = starter.extraFiles?.length
    ? `${starter.extraFiles.join('\n')}\n`
    : '';

  return `# ${options.projectName}

Generated by @fluojs/cli.

- Shape: \`microservice\`
- Transport: \`${starter.readmeTransportLabel}\` is the generated runnable starter contract for this project
- Runtime: \`node\`
- Platform: \`none\` because the microservice starter boots through \`@fluojs/microservices\`, not an HTTP adapter
- Package manager: install/run commands can use ${options.packageManager}; ${starter.packageManagerNote}
- Messaging contract: \`src/math/math.handler.ts\` exposes a \`${starter.pattern}\` message pattern and the generated tests verify it through an in-memory transport so the starter stays testable without external brokers
- Entrypoint contract: ${starter.entrypointNote}
- Starter contract note: ${starter.starterNote}
- ${starter.runtimeDependencyNote}

## Commands

- Dev: ${createRunCommand(options.packageManager, 'dev')}
- Build: ${createRunCommand(options.packageManager, 'build')}
- Typecheck: ${createRunCommand(options.packageManager, 'typecheck')}
- Test: ${createRunCommand(options.packageManager, 'test')}

## Starter transport notes

${starter.configLines.join('\n')}
- Default transport behavior: omitting \`--transport\` still resolves to the TCP starter path
- Additional documented-but-not-yet-generated families stay validation-only in this release: \`redis\`

## Official generated testing templates

- \`src/math/math.handler.test.ts\` — unit template for the starter-owned message handler.
- \`src/app.test.ts\` — integration-style microservice test via an in-memory transport implementation.

## Generated files that define the starter contract

- \`src/app.ts\` — transport registration and environment-driven runtime wiring.
- \`src/main.ts\` — microservice bootstrap entrypoint.
- \`src/math/*\` — starter-owned message handler slice proving the generated transport contract.
${extraFilesSection}
## Generated-project verification

- ${starter.generatedProjectVerification}

Use the unit template for handler logic and the integration template when you need runtime wiring confidence. ${starter.testNote}
`;
}

function createProjectReadme(options: BootstrapOptions, bootstrapPlan: ResolvedBootstrapPlan): string {
  if (bootstrapPlan.profile.emitter.type === 'microservice') {
    return createMicroserviceProjectReadme(options);
  }

  if (bootstrapPlan.profile.id === 'mixed-node-fastify-tcp') {
    return createMixedProjectReadme(options);
  }

  return createHttpProjectReadme(options);
}

function createAppFile(options: BootstrapOptions): string {
  const importSuffix = options.runtime === 'deno' ? '.ts' : '';

  if (options.runtime === 'cloudflare-workers') {
    return `import { Global, Module } from '@fluojs/core';
import { createHealthModule } from '@fluojs/runtime';

import { HealthModule } from './health/health.module';

const RuntimeHealthModule = createHealthModule();

@Global()
@Module({
  imports: [
    HealthModule,
    RuntimeHealthModule,
  ],
})
export class AppModule {}
`;
  }

  const processEnvValue = options.runtime === 'bun'
    ? 'Bun.env'
    : options.runtime === 'deno'
      ? 'Deno.env.toObject()'
      : 'process.env';

  return `import { Global, Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { createHealthModule } from '@fluojs/runtime';

import { HealthModule } from './health/health.module${importSuffix}';

const RuntimeHealthModule = createHealthModule();

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: ${processEnvValue},
    }),
    HealthModule,
    RuntimeHealthModule,
  ],
})
export class AppModule {}
`;
}

function createHealthResponseDtoFile(): string {
  return `export class HealthResponseDto {
  ok!: boolean;
  service!: string;
}
`;
}

function createHealthRepoFile(projectName: string, importSuffix = ''): string {
  return `import type { HealthResponseDto } from './health.response.dto${importSuffix}';

export class HealthRepo {
  findHealth(): HealthResponseDto {
    return {
      ok: true,
      service: ${JSON.stringify(projectName)},
    };
  }
}
`;
}

function createHealthRepoTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import { HealthRepo } from './health.repo';

describe('HealthRepo', () => {
  it('returns health data', () => {
    const repo = new HealthRepo();
    expect(repo.findHealth()).toEqual({ ok: true, service: expect.any(String) });
  });
});
`;
}

function createHealthServiceFile(importSuffix = ''): string {
  return `import { Inject } from '@fluojs/core';
import type { HealthResponseDto } from './health.response.dto${importSuffix}';

import { HealthRepo } from './health.repo${importSuffix}';

@Inject(HealthRepo)
export class HealthService {
  constructor(private readonly repo: HealthRepo) {}

  getHealth(): HealthResponseDto {
    return this.repo.findHealth();
  }
}
`;
}

function createHealthServiceTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import { HealthService } from './health.service';
import { HealthRepo } from './health.repo';

class FakeHealthRepo {
  findHealth() {
    return { ok: true, service: 'test' };
  }
}

describe('HealthService', () => {
  it('delegates to the repo', () => {
    const service = new HealthService(new FakeHealthRepo() as HealthRepo);
    expect(service.getHealth()).toEqual({ ok: true, service: 'test' });
  });
});
`;
}

function createHealthControllerFile(importSuffix = ''): string {
  return `import { Inject } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';

import { HealthService } from './health.service${importSuffix}';
import { HealthResponseDto } from './health.response.dto${importSuffix}';

@Inject(HealthService)
@Controller('/health-info')
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get('/')
  getHealth(): HealthResponseDto {
    return this.service.getHealth();
  }
}
`;
}

function createHealthControllerTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

class FakeHealthService {
  getHealth() {
    return { ok: true, service: 'test' };
  }
}

describe('HealthController', () => {
  it('delegates to the service', () => {
    const controller = new HealthController(new FakeHealthService() as never);
    expect(controller.getHealth()).toEqual({ ok: true, service: 'test' });
  });
});
`;
}

function createHealthModuleFile(importSuffix = ''): string {
  return `import { Module } from '@fluojs/core';

import { HealthController } from './health.controller${importSuffix}';
import { HealthRepo } from './health.repo${importSuffix}';
import { HealthService } from './health.service${importSuffix}';

@Module({
  controllers: [HealthController],
  providers: [HealthRepo, HealthService],
})
export class HealthModule {}
`;
}

function createMainFile(options: BootstrapOptions): string {
  const starter = describeApplicationStarter(options);

  if (options.runtime === 'deno') {
    return `import { runDenoApplication } from '@fluojs/platform-deno';

import { AppModule } from './app.ts';

// The generated starter wires the selected first-class fluo new application path:
// Deno runtime + Deno native HTTP via runDenoApplication(...).

const parsedPort = Number.parseInt(Deno.env.get('PORT') ?? '3000', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 3000;

await runDenoApplication(AppModule, { port });
`;
  }

  if (options.runtime === 'cloudflare-workers') {
    return `import { createCloudflareWorkerEntrypoint } from '@fluojs/platform-cloudflare-workers';

import { AppModule } from './app';

// The generated starter wires the selected first-class fluo new application path:
// Cloudflare Workers runtime + Cloudflare Workers HTTP via createCloudflareWorkerEntrypoint(...).

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
`;
  }

  const portExpression = options.runtime === 'bun'
    ? "Bun.env.PORT ?? '3000'"
    : "process.env.PORT ?? '3000'";

  return `import { ${starter.adapterFactory} } from '${starter.packageName}';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app';

// The generated starter wires the selected first-class fluo new application path:
// ${starter.runtimeLabel} + ${starter.platformLabel} via ${starter.adapterFactory}(...).

const parsedPort = Number.parseInt(${portExpression}, 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 3000;

const app = await FluoFactory.create(AppModule, {
  adapter: ${starter.adapterCall},
});
await app.listen();
`;
}

function createMicroserviceAppFile(options: Pick<BootstrapOptions, 'transport'>): string {
  switch (options.transport) {
    case 'redis-streams':
      return `import Redis from 'ioredis';
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { MicroservicesModule, RedisStreamsMicroserviceTransport, type RedisStreamClientLike } from '@fluojs/microservices';

import { MathHandler } from './math/math.handler';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const namespace = process.env.REDIS_STREAMS_NAMESPACE ?? 'fluo:streams';
const consumerGroup = process.env.REDIS_STREAMS_CONSUMER_GROUP ?? 'fluo-handlers';
const readerRedis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
const writerRedis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

const readerClient: RedisStreamClientLike = {
  async xack(stream, group, id) {
    await readerRedis.xack(stream, group, id);
  },
  async xadd(stream, fields) {
    return await readerRedis.xadd(stream, '*', ...Object.entries(fields).flatMap(([key, value]) => [key, value]));
  },
  async xgroupCreate(stream, group, startId, mkstream) {
    if (mkstream) {
      await readerRedis.xgroup('CREATE', stream, group, startId, 'MKSTREAM');
      return;
    }

    await readerRedis.xgroup('CREATE', stream, group, startId);
  },
  async xgroupDestroy(stream, group) {
    await readerRedis.xgroup('DESTROY', stream, group);
  },
  async xreadgroup(group, consumer, streams, options) {
    const response = await readerRedis.xreadgroup(
      'GROUP',
      group,
      consumer,
      options?.count ? 'COUNT' : undefined,
      options?.count ? String(options.count) : undefined,
      options?.blockMs ? 'BLOCK' : undefined,
      options?.blockMs ? String(options.blockMs) : undefined,
      'STREAMS',
      ...streams,
      ...streams.map(() => '>'),
    );

    if (!response) {
      return null;
    }

    return response.flatMap(([, entries]) => entries.map(([id, values]) => ({
      fields: Object.fromEntries(values.reduce<string[][]>((pairs, value, index, source) => {
        if (index % 2 === 0) {
          pairs.push([value, source[index + 1] ?? '']);
        }
        return pairs;
      }, [])),
      id,
    })));
  },
};

const writerClient: RedisStreamClientLike = {
  async xack(stream, group, id) {
    await writerRedis.xack(stream, group, id);
  },
  async xadd(stream, fields) {
    return await writerRedis.xadd(stream, '*', ...Object.entries(fields).flatMap(([key, value]) => [key, value]));
  },
  async xgroupCreate(stream, group, startId, mkstream) {
    if (mkstream) {
      await writerRedis.xgroup('CREATE', stream, group, startId, 'MKSTREAM');
      return;
    }

    await writerRedis.xgroup('CREATE', stream, group, startId);
  },
  async xgroupDestroy(stream, group) {
    await writerRedis.xgroup('DESTROY', stream, group);
  },
  async xreadgroup(group, consumer, streams, options) {
    const response = await writerRedis.xreadgroup(
      'GROUP',
      group,
      consumer,
      options?.count ? 'COUNT' : undefined,
      options?.count ? String(options.count) : undefined,
      options?.blockMs ? 'BLOCK' : undefined,
      options?.blockMs ? String(options.blockMs) : undefined,
      'STREAMS',
      ...streams,
      ...streams.map(() => '>'),
    );

    if (!response) {
      return null;
    }

    return response.flatMap(([, entries]) => entries.map(([id, values]) => ({
      fields: Object.fromEntries(values.reduce<string[][]>((pairs, value, index, source) => {
        if (index % 2 === 0) {
          pairs.push([value, source[index + 1] ?? '']);
        }
        return pairs;
      }, [])),
      id,
    })));
  },
};

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    MicroservicesModule.forRoot({
      transport: new RedisStreamsMicroserviceTransport({
        consumerGroup,
        namespace,
        readerClient,
        writerClient,
      }),
    }),
  ],
  providers: [MathHandler],
})
export class AppModule {}
`;
    case 'mqtt':
      return `import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { MicroservicesModule, MqttMicroserviceTransport } from '@fluojs/microservices';

import { MathHandler } from './math/math.handler';

const url = process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883';
const namespace = process.env.MQTT_NAMESPACE ?? 'fluo.microservices';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    MicroservicesModule.forRoot({
      transport: new MqttMicroserviceTransport({
        namespace,
        requestTimeoutMs: 3_000,
        url,
      }),
    }),
  ],
  providers: [MathHandler],
})
export class AppModule {}
`;
    case 'grpc':
      return `import { resolve } from 'node:path';

import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { GrpcMicroserviceTransport, MicroservicesModule } from '@fluojs/microservices';

import { MathHandler } from './math/math.handler';

const url = process.env.GRPC_URL ?? '127.0.0.1:50051';
const protoPath = resolve(process.cwd(), 'proto', 'math.proto');

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    MicroservicesModule.forRoot({
      transport: new GrpcMicroserviceTransport({
        packageName: 'fluo.microservices',
        protoPath,
        services: ['MathService'],
        url,
      }),
    }),
  ],
  providers: [MathHandler],
})
export class AppModule {}
`;
    case 'nats':
      return `import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { MicroservicesModule, NatsMicroserviceTransport } from '@fluojs/microservices';
import { JSONCodec, connect } from 'nats';

import { MathHandler } from './math/math.handler';

const servers = (process.env.NATS_SERVERS ?? 'nats://127.0.0.1:4222')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const eventSubject = process.env.NATS_EVENT_SUBJECT ?? 'fluo.microservices.events';
const messageSubject = process.env.NATS_MESSAGE_SUBJECT ?? 'fluo.microservices.messages';
const codec = JSONCodec();
const connection = await connect({
  name: 'fluo-microservice-starter',
  servers,
});
const client = {
  close() {
    void connection.close();
  },
  publish(subject: string, payload: Uint8Array) {
    connection.publish(subject, payload);
  },
  request(subject: string, payload: Uint8Array, options?: { timeout?: number }) {
    return connection.request(subject, payload, options);
  },
  subscribe(subject: string, handler: (message: { data: Uint8Array; respond(data: Uint8Array): void }) => void) {
    const subscription = connection.subscribe(subject);

    void (async () => {
      for await (const message of subscription) {
        handler(message);
      }
    })();

    return {
      unsubscribe() {
        subscription.unsubscribe();
      },
    };
  },
};

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    MicroservicesModule.forRoot({
      transport: new NatsMicroserviceTransport({
        client,
        codec,
        eventSubject,
        messageSubject,
        requestTimeoutMs: 3_000,
      }),
    }),
  ],
  providers: [MathHandler],
})
export class AppModule {}
`;
    case 'kafka':
      return `import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { Kafka, logLevel } from 'kafkajs';
import { KafkaMicroserviceTransport, MicroservicesModule } from '@fluojs/microservices';

import { MathHandler } from './math/math.handler';

const brokers = (process.env.KAFKA_BROKERS ?? '127.0.0.1:9092')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const clientId = process.env.KAFKA_CLIENT_ID ?? 'fluo-microservice-starter';
const consumerGroup = process.env.KAFKA_CONSUMER_GROUP ?? 'fluo-handlers';
const eventTopic = process.env.KAFKA_EVENT_TOPIC ?? 'fluo.microservices.events';
const messageTopic = process.env.KAFKA_MESSAGE_TOPIC ?? 'fluo.microservices.messages';
const responseTopic = process.env.KAFKA_RESPONSE_TOPIC ?? 'fluo.microservices.responses';
const kafka = new Kafka({
  brokers,
  clientId,
  logLevel: logLevel.NOTHING,
});
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: consumerGroup });
await Promise.all([producer.connect(), consumer.connect()]);

const handlers = new Map<string, (message: string) => Promise<void> | void>();
let consumerRunning = false;

const producerClient = {
  async publish(topic: string, message: string) {
    await producer.send({
      messages: [{ value: message }],
      topic,
    });
  },
};

const consumerClient = {
  async subscribe(topic: string, handler: (message: string) => Promise<void> | void) {
    handlers.set(topic, handler);
    await consumer.subscribe({ fromBeginning: false, topic });

    if (consumerRunning) {
      return;
    }

    consumerRunning = true;
    void consumer.run({
      eachMessage: async ({ topic, message }) => {
        const value = message.value?.toString();

        if (!value) {
          return;
        }

        await handlers.get(topic)?.(value);
      },
    });
  },
  async unsubscribe(topic: string) {
    handlers.delete(topic);

    if (handlers.size > 0) {
      return;
    }

    consumerRunning = false;
    await consumer.stop();
    await Promise.all([consumer.disconnect(), producer.disconnect()]);
  },
};

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    MicroservicesModule.forRoot({
      transport: new KafkaMicroserviceTransport({
        consumer: consumerClient,
        eventTopic,
        messageTopic,
        producer: producerClient,
        requestTimeoutMs: 3_000,
        responseTopic,
      }),
    }),
  ],
  providers: [MathHandler],
})
export class AppModule {}
`;
    case 'rabbitmq':
      return `import { connect } from 'amqplib';

import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { MicroservicesModule, RabbitMqMicroserviceTransport } from '@fluojs/microservices';

import { MathHandler } from './math/math.handler';

const url = process.env.RABBITMQ_URL ?? 'amqp://127.0.0.1:5672';
const eventQueue = process.env.RABBITMQ_EVENT_QUEUE ?? 'fluo.microservices.events';
const messageQueue = process.env.RABBITMQ_MESSAGE_QUEUE ?? 'fluo.microservices.messages';
const responseQueue = process.env.RABBITMQ_RESPONSE_QUEUE ?? 'fluo.microservices.responses';
const connection = await connect(url);
const channel = await connection.createConfirmChannel();
const consumerTags = new Map<string, string>();

const publisher = {
  async publish(queue: string, message: string) {
    await channel.assertQueue(queue, { durable: true });
    await new Promise<void>((resolve, reject) => {
      channel.sendToQueue(queue, Buffer.from(message), { persistent: true }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  },
};

const consumer = {
  async cancel(queue: string) {
    const consumerTag = consumerTags.get(queue);

    if (!consumerTag) {
      return;
    }

    consumerTags.delete(queue);
    await channel.cancel(consumerTag);

    if (consumerTags.size === 0) {
      await channel.close();
      await connection.close();
    }
  },
  async consume(queue: string, handler: (message: string) => Promise<void> | void) {
    await channel.assertQueue(queue, { durable: true });
    const result = await channel.consume(queue, (message) => {
      if (!message) {
        return;
      }

      void Promise.resolve(handler(message.content.toString()))
        .then(() => {
          channel.ack(message);
        })
        .catch(() => {
          channel.nack(message, false, false);
        });
    });

    consumerTags.set(queue, result.consumerTag);
  },
};

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    MicroservicesModule.forRoot({
      transport: new RabbitMqMicroserviceTransport({
        consumer,
        eventQueue,
        messageQueue,
        publisher,
        requestTimeoutMs: 3_000,
        responseQueue,
      }),
    }),
  ],
  providers: [MathHandler],
})
export class AppModule {}
`;
    default:
      return `import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { MicroservicesModule, TcpMicroserviceTransport } from '@fluojs/microservices';

import { MathHandler } from './math/math.handler';

const parsedPort = Number.parseInt(process.env.MICROSERVICE_PORT ?? '4000', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 4000;
const host = process.env.MICROSERVICE_HOST ?? '127.0.0.1';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({ host, port }),
    }),
  ],
  providers: [MathHandler],
})
export class AppModule {}
`;
  }
}

function createMicroserviceMainFile(): string {
  return `import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app';

const microservice = await FluoFactory.createMicroservice(AppModule);
await microservice.listen();
`;
}

function createMathHandlerFile(options: Pick<BootstrapOptions, 'transport'>): string {
  const pattern = describeMicroserviceStarter(options).pattern;

  if (options.transport === 'grpc') {
    return `import { MessagePattern } from '@fluojs/microservices';

type SumInput = {
  a: number;
  b: number;
};

type SumResponse = {
  result: number;
};

export class MathHandler {
  @MessagePattern(${JSON.stringify(pattern)})
  sum(input: SumInput): SumResponse {
    return { result: input.a + input.b };
  }
}
`;
  }

  return `import { MessagePattern } from '@fluojs/microservices';

type SumInput = {
  a: number;
  b: number;
};

export class MathHandler {
  @MessagePattern(${JSON.stringify(pattern)})
  sum(input: SumInput): number {
    return input.a + input.b;
  }
}
`;
}

function createMathHandlerTestFile(options: Pick<BootstrapOptions, 'transport'>): string {
  const expectation = createMicroserviceResponseExpectation(options);

  return `import { describe, expect, it } from 'vitest';

import { MathHandler } from './math.handler';

describe('MathHandler', () => {
  it('sums message payload values', () => {
    const handler = new MathHandler();

    expect(handler.sum({ a: 20, b: 22 })).toEqual(${expectation});
  });
});
`;
}

function createMicroserviceAppTestFile(options: Pick<BootstrapOptions, 'transport'>): string {
  const pattern = describeMicroserviceStarter(options).pattern;
  const expectation = createMicroserviceResponseExpectation(options);

  return `import { describe, expect, it } from 'vitest';

import { Module } from '@fluojs/core';
import {
  MicroservicesModule,
  type MicroserviceTransport,
} from '@fluojs/microservices';
import { FluoFactory } from '@fluojs/runtime';

import { MathHandler } from './math/math.handler';

type TransportHandler = Parameters<MicroserviceTransport['listen']>[0];

class InMemoryLoopbackTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;

  async close(): Promise<void> {
    this.handler = undefined;
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    if (!this.handler) {
      throw new Error('Transport handler is not listening.');
    }

    await this.handler({ kind: 'event', pattern, payload });
  }

  async listen(handler: TransportHandler): Promise<void> {
    this.handler = handler;
  }

  async send(pattern: string, payload: unknown): Promise<unknown> {
    if (!this.handler) {
      throw new Error('Transport handler is not listening.');
    }

    return await this.handler({ kind: 'message', pattern, payload });
  }
}

describe('AppModule microservice starter', () => {
  it('routes message patterns through the generated transport contract', async () => {
    const transport = new InMemoryLoopbackTransport();

    @Module({
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [MathHandler],
    })
    class TestAppModule {}

    const microservice = await FluoFactory.createMicroservice(TestAppModule);
    await microservice.listen();

    await expect(transport.send(${JSON.stringify(pattern)}, { a: 19, b: 23 })).resolves.toEqual(${expectation});

    await microservice.close();
  });
});
`;
}

function createGrpcProtoFile(): string {
  return `syntax = "proto3";

package fluo.microservices;

service MathService {
  rpc Sum (SumRequest) returns (SumResponse);
}

message SumRequest {
  int32 a = 1;
  int32 b = 2;
}

message SumResponse {
  int32 result = 1;
}
`;
}

function createMixedProjectReadme(options: BootstrapOptions): string {
  return `# ${options.projectName}

Generated by @fluojs/cli.

- Shape: \`mixed\`
- Supported topology: \`single-package\` generates one shared Node.js package where the Fastify HTTP application also starts an attached TCP microservice from the same \`src/main.ts\`
- Runtime contract: \`src/app.ts\` owns one shared module graph, and \`src/main.ts\` bootstraps the HTTP API before calling \`connectMicroservice()\` and \`startAllMicroservices()\`
- Intentional limitation: the first mixed release supports only the explicit Fastify HTTP + attached TCP microservice contract; other mixed transports or separate multi-entrypoint layouts fail validation instead of generating partial scaffolds

## Commands

- Dev: ${createRunCommand(options.packageManager, 'dev')}
- Build: ${createRunCommand(options.packageManager, 'build')}
- Typecheck: ${createRunCommand(options.packageManager, 'typecheck')}
- Test: ${createRunCommand(options.packageManager, 'test')}

## Generated topology

- \`src/app.ts\` — shared application module with config, runtime health endpoints, and the TCP microservice registration.
- \`src/main.ts\` — Fastify HTTP bootstrap that also starts the attached TCP microservice.
- \`src/health/*\` — starter-owned HTTP health slice.
- \`src/math/*\` — starter-owned message handler slice that proves the microservice half of the topology.

## Official generated testing templates

- \`src/health/*.test.ts\` — unit templates for the HTTP slice.
- \`src/math/math.handler.test.ts\` — unit template for the microservice handler.
- \`src/app.test.ts\` — hybrid verification template covering HTTP dispatch plus in-memory message routing with the same shared module contract.

Use the unit templates for fast logic checks. Use the mixed verification template when you need confidence that both generated entrypoints still share one behavioral contract.
`;
}

function createMixedAppFile(): string {
  return `import { Global, Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { MicroservicesModule, TcpMicroserviceTransport } from '@fluojs/microservices';
import { createHealthModule } from '@fluojs/runtime';

import { HealthModule } from './health/health.module';
import { MathHandler } from './math/math.handler';

const RuntimeHealthModule = createHealthModule();
const parsedMicroservicePort = Number.parseInt(process.env.MICROSERVICE_PORT ?? '4000', 10);
const microservicePort = Number.isFinite(parsedMicroservicePort) ? parsedMicroservicePort : 4000;
const microserviceHost = process.env.MICROSERVICE_HOST ?? '127.0.0.1';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    HealthModule,
    RuntimeHealthModule,
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({ host: microserviceHost, port: microservicePort }),
    }),
  ],
  providers: [MathHandler],
})
export class AppModule {}
`;
}

function createMixedMainFile(): string {
  return `import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app';

const parsedPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 3000;

const app = await FluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port }),
});
await app.connectMicroservice();
await app.startAllMicroservices();
await app.listen();
`;
}

function createMixedAppTestFile(): string {
  return `import { describe, expect, it } from 'vitest';

import { Global, Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import {
  MicroservicesModule,
  type MicroserviceTransport,
} from '@fluojs/microservices';
import { FluoFactory, createHealthModule } from '@fluojs/runtime';

import { HealthModule } from './health/health.module';
import { MathHandler } from './math/math.handler';

type TransportHandler = Parameters<MicroserviceTransport['listen']>[0];

class InMemoryLoopbackTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;

  async close(): Promise<void> {
    this.handler = undefined;
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    if (!this.handler) {
      throw new Error('Transport handler is not listening.');
    }

    await this.handler({ kind: 'event', pattern, payload });
  }

  async listen(handler: TransportHandler): Promise<void> {
    this.handler = handler;
  }

  async send(pattern: string, payload: unknown): Promise<unknown> {
    if (!this.handler) {
      throw new Error('Transport handler is not listening.');
    }

    return await this.handler({ kind: 'message', pattern, payload });
  }
}

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('AppModule mixed starter', () => {
  it('keeps HTTP routes and message handlers in one explicit topology contract', async () => {
    const transport = new InMemoryLoopbackTransport();
    const RuntimeHealthModule = createHealthModule();

    @Global()
    @Module({
      imports: [
        ConfigModule.forRoot({
          envFile: '.env',
          processEnv: process.env,
        }),
        HealthModule,
        RuntimeHealthModule,
        MicroservicesModule.forRoot({ transport }),
      ],
      providers: [MathHandler],
    })
    class TestAppModule {}

    const app = await FluoFactory.create(TestAppModule, {});
    const healthResponse = createResponse();

    const microservice = await app.connectMicroservice();

    await Promise.all([app.startAllMicroservices(), app.dispatch(createRequest('/health-info/'), healthResponse)]);

    expect(healthResponse.body).toEqual({ ok: true, service: expect.any(String) });
    await expect(transport.send('math.sum', { a: 20, b: 22 })).resolves.toBe(42);
    expect(microservice.state).toBe('ready');

    await app.close();
  });
});
`;
}

function createAppTestFile(importSuffix = ''): string {
  return `import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app${importSuffix}';

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('AppModule', () => {
  it('dispatches the runtime health and readiness routes', async () => {
    const app = await FluoFactory.create(AppModule, {});
    const healthResponse = createResponse();
    const readyResponse = createResponse();

    await app.dispatch(createRequest('/health'), healthResponse);
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(healthResponse.body).toEqual({ status: 'ok' });
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('dispatches the health-info route', async () => {
    const app = await FluoFactory.create(AppModule, {});
    const response = createResponse();

    await app.dispatch(createRequest('/health-info/'), response);

    expect(response.body).toEqual({ ok: true, service: expect.any(String) });

    await app.close();
  });
});
`;
}

function createAppE2eTestFile(importSuffix = ''): string {
  return `import { describe, expect, it } from 'vitest';

import { createTestApp } from '@fluojs/testing';

import { AppModule } from './app${importSuffix}';

describe('AppModule e2e', () => {
  it('serves runtime and starter routes through createTestApp', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    await expect(app.dispatch({ method: 'GET', path: '/health' })).resolves.toMatchObject({
      body: { status: 'ok' },
      status: 200,
    });
    await expect(app.dispatch({ method: 'GET', path: '/ready' })).resolves.toMatchObject({
      body: { status: 'ready' },
      status: 200,
    });
    await expect(app.dispatch({ method: 'GET', path: '/health-info/' })).resolves.toMatchObject({
      body: { ok: true, service: expect.any(String) },
      status: 200,
    });

    await app.close();
  });
});
`;
}

function createDenoAppTestFile(): string {
  return `import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app.ts';

type ResponseStub = {
  body?: unknown;
  committed: boolean;
  headers: Record<string, string>;
  redirect(status: number, location: string): void;
  send(body: unknown): void;
  setHeader(name: string, value: string): void;
  setStatus(code: number): void;
  statusCode?: number;
  statusSet: boolean;
};

function createResponse(): ResponseStub {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

Deno.test('AppModule dispatches the generated Deno starter routes', async () => {
  const app = await FluoFactory.create(AppModule, {});
  const healthResponse = createResponse();
  const readyResponse = createResponse();
  const infoResponse = createResponse();

  await app.dispatch({ body: undefined, cookies: {}, headers: {}, method: 'GET', params: {}, path: '/health', query: {}, raw: {}, url: '/health' }, healthResponse as never);
  await app.dispatch({ body: undefined, cookies: {}, headers: {}, method: 'GET', params: {}, path: '/ready', query: {}, raw: {}, url: '/ready' }, readyResponse as never);
  await app.dispatch({ body: undefined, cookies: {}, headers: {}, method: 'GET', params: {}, path: '/health-info/', query: {}, raw: {}, url: '/health-info/' }, infoResponse as never);

  if (JSON.stringify(healthResponse.body) !== JSON.stringify({ status: 'ok' })) {
    throw new Error('Expected /health to return status ok.');
  }

  if (JSON.stringify(readyResponse.body) !== JSON.stringify({ status: 'ready' })) {
    throw new Error('Expected /ready to return status ready.');
  }

  if (typeof infoResponse.body !== 'object' || infoResponse.body === null) {
    throw new Error('Expected /health-info/ to return an object body.');
  }

  const infoBody = infoResponse.body as { ok?: unknown; service?: unknown };
  if (infoBody.ok !== true || typeof infoBody.service !== 'string') {
    throw new Error('Expected /health-info/ to return the generated service payload.');
  }

  await app.close();
});
`;
}

function createEnvFile(bootstrapPlan: ResolvedBootstrapPlan): string | undefined {
  if (bootstrapPlan.profile.id === 'application-cloudflare-workers-cloudflare-workers-http') {
    return undefined;
  }

  if (bootstrapPlan.profile.id === 'microservice-node-none-tcp' || bootstrapPlan.profile.id === 'mixed-node-fastify-tcp') {
    return `MICROSERVICE_HOST=127.0.0.1
MICROSERVICE_PORT=4000
PORT=3000
`;
  }

  if (bootstrapPlan.profile.id === 'microservice-node-none-redis-streams') {
    return `REDIS_URL=redis://127.0.0.1:6379
REDIS_STREAMS_NAMESPACE=fluo:streams
REDIS_STREAMS_CONSUMER_GROUP=fluo-handlers
PORT=3000
`;
  }

  if (bootstrapPlan.profile.id === 'microservice-node-none-mqtt') {
    return `MQTT_URL=mqtt://127.0.0.1:1883
MQTT_NAMESPACE=fluo.microservices
PORT=3000
`;
  }

  if (bootstrapPlan.profile.id === 'microservice-node-none-grpc') {
    return `GRPC_URL=127.0.0.1:50051
PORT=3000
`;
  }

  if (bootstrapPlan.profile.id === 'microservice-node-none-nats') {
    return `NATS_SERVERS=nats://127.0.0.1:4222
NATS_EVENT_SUBJECT=fluo.microservices.events
NATS_MESSAGE_SUBJECT=fluo.microservices.messages
PORT=3000
`;
  }

  if (bootstrapPlan.profile.id === 'microservice-node-none-kafka') {
    return `KAFKA_BROKERS=127.0.0.1:9092
KAFKA_CLIENT_ID=fluo-microservice-starter
KAFKA_CONSUMER_GROUP=fluo-handlers
KAFKA_EVENT_TOPIC=fluo.microservices.events
KAFKA_MESSAGE_TOPIC=fluo.microservices.messages
KAFKA_RESPONSE_TOPIC=fluo.microservices.responses
PORT=3000
`;
  }

  if (bootstrapPlan.profile.id === 'microservice-node-none-rabbitmq') {
    return `RABBITMQ_URL=amqp://127.0.0.1:5672
RABBITMQ_EVENT_QUEUE=fluo.microservices.events
RABBITMQ_MESSAGE_QUEUE=fluo.microservices.messages
RABBITMQ_RESPONSE_QUEUE=fluo.microservices.responses
PORT=3000
`;
  }

  return `PORT=3000
`;
}

type ScaffoldFile = {
  content: string;
  path: string;
};

function createWranglerConfig(projectName: string): string {
  return `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": ${JSON.stringify(projectName)},
  "main": "src/worker.ts",
  "compatibility_date": "2026-04-11"
}
`;
}

function emitSharedScaffoldFiles(
  options: BootstrapOptions,
  bootstrapPlan: ResolvedBootstrapPlan,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): ScaffoldFile[] {
  const envFile = createEnvFile(bootstrapPlan);
  const sharedFiles: ScaffoldFile[] = [
    { content: createProjectPackageJson(options, bootstrapPlan, releaseVersion, packageSpecs), path: 'package.json' },
    { content: createProjectReadme(options, bootstrapPlan), path: 'README.md' },
    { content: createGitignore(), path: '.gitignore' },
  ];

  if (bootstrapPlan.profile.id !== 'application-deno-deno-http') {
    sharedFiles.push(
      { content: createProjectTsconfig(), path: 'tsconfig.json' },
      { content: createProjectTsconfigBuild(), path: 'tsconfig.build.json' },
      { content: createBabelConfig(), path: 'babel.config.cjs' },
      { content: createViteConfig(), path: 'vite.config.ts' },
      { content: createVitestConfig(), path: 'vitest.config.ts' },
    );
  }

  if (bootstrapPlan.profile.id === 'application-cloudflare-workers-cloudflare-workers-http') {
    sharedFiles.push({ content: createWranglerConfig(options.projectName), path: 'wrangler.jsonc' });
  }

  if (envFile) {
    sharedFiles.push({ content: envFile, path: '.env' });
  }

  return sharedFiles;
}

function emitApplicationScaffoldFiles(options: BootstrapOptions): ScaffoldFile[] {
  const importSuffix = options.runtime === 'deno' ? '.ts' : '';
  const entrypointPath = describeApplicationStarter(options).entrypoint;
  const files: ScaffoldFile[] = [
    { content: createAppFile(options), path: 'src/app.ts' },
    { content: createMainFile(options), path: entrypointPath },
    { content: createHealthResponseDtoFile(), path: 'src/health/health.response.dto.ts' },
    { content: createHealthRepoFile(options.projectName, importSuffix), path: 'src/health/health.repo.ts' },
    { content: createHealthServiceFile(importSuffix), path: 'src/health/health.service.ts' },
    { content: createHealthControllerFile(importSuffix), path: 'src/health/health.controller.ts' },
    { content: createHealthModuleFile(importSuffix), path: 'src/health/health.module.ts' },
  ];

  if (options.runtime === 'deno') {
    files.push({ content: createDenoAppTestFile(), path: 'src/app.test.ts' });
    return files;
  }

  files.push(
    { content: createHealthRepoTestFile(), path: 'src/health/health.repo.test.ts' },
    { content: createHealthServiceTestFile(), path: 'src/health/health.service.test.ts' },
    { content: createHealthControllerTestFile(), path: 'src/health/health.controller.test.ts' },
    { content: createAppTestFile(importSuffix), path: 'src/app.test.ts' },
    { content: createAppE2eTestFile(importSuffix), path: 'src/app.e2e.test.ts' },
  );

  return files;
}

function emitScaffoldFilesForRecipe(options: BootstrapOptions, recipeId: StarterScaffoldRecipeId): ScaffoldFile[] {
  if (
    recipeId === 'application-bun-bun-http'
    || recipeId === 'application-cloudflare-workers-cloudflare-workers-http'
    || recipeId === 'application-deno-deno-http'
    ||
    recipeId === 'application-node-fastify-http'
    || recipeId === 'application-node-express-http'
    || recipeId === 'application-node-nodejs-http'
  ) {
    return emitApplicationScaffoldFiles(options);
  }

  if (
    recipeId === 'microservice-node-none-tcp'
    || recipeId === 'microservice-node-none-redis-streams'
    || recipeId === 'microservice-node-none-mqtt'
    || recipeId === 'microservice-node-none-grpc'
    || recipeId === 'microservice-node-none-nats'
    || recipeId === 'microservice-node-none-kafka'
    || recipeId === 'microservice-node-none-rabbitmq'
  ) {
    const transport = recipeId === 'microservice-node-none-redis-streams'
      ? 'redis-streams'
      : recipeId === 'microservice-node-none-mqtt'
        ? 'mqtt'
        : recipeId === 'microservice-node-none-nats'
          ? 'nats'
          : recipeId === 'microservice-node-none-kafka'
            ? 'kafka'
            : recipeId === 'microservice-node-none-rabbitmq'
              ? 'rabbitmq'
        : recipeId === 'microservice-node-none-grpc'
          ? 'grpc'
          : 'tcp';
    const files: ScaffoldFile[] = [
      { content: createMicroserviceAppFile({ transport }), path: 'src/app.ts' },
      { content: createMicroserviceMainFile(), path: 'src/main.ts' },
      { content: createMathHandlerFile({ transport }), path: 'src/math/math.handler.ts' },
      { content: createMathHandlerTestFile({ transport }), path: 'src/math/math.handler.test.ts' },
      { content: createMicroserviceAppTestFile({ transport }), path: 'src/app.test.ts' },
    ];

    if (recipeId === 'microservice-node-none-grpc') {
      files.push({ content: createGrpcProtoFile(), path: 'proto/math.proto' });
    }

    return files;
  }

  if (recipeId === 'mixed-node-fastify-tcp') {
    return [
      { content: createMixedAppFile(), path: 'src/app.ts' },
      { content: createMixedMainFile(), path: 'src/main.ts' },
      { content: createHealthResponseDtoFile(), path: 'src/health/health.response.dto.ts' },
      { content: createHealthRepoFile(options.projectName), path: 'src/health/health.repo.ts' },
      { content: createHealthRepoTestFile(), path: 'src/health/health.repo.test.ts' },
      { content: createHealthServiceFile(), path: 'src/health/health.service.ts' },
      { content: createHealthServiceTestFile(), path: 'src/health/health.service.test.ts' },
      { content: createHealthControllerFile(), path: 'src/health/health.controller.ts' },
      { content: createHealthControllerTestFile(), path: 'src/health/health.controller.test.ts' },
      { content: createHealthModuleFile(), path: 'src/health/health.module.ts' },
      { content: createMathHandlerFile({ transport: 'tcp' }), path: 'src/math/math.handler.ts' },
      { content: createMathHandlerTestFile({ transport: 'tcp' }), path: 'src/math/math.handler.test.ts' },
      { content: createMixedAppTestFile(), path: 'src/app.test.ts' },
    ];
  }

  return [];
}

function emitScaffoldFilesForPlan(options: BootstrapOptions, bootstrapPlan: ResolvedBootstrapPlan): ScaffoldFile[] {
  return emitScaffoldFilesForRecipe(options, bootstrapPlan.profile.id);
}

function buildScaffoldFiles(
  options: BootstrapOptions,
  bootstrapPlan: ResolvedBootstrapPlan,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): ScaffoldFile[] {
  return [
    ...emitSharedScaffoldFiles(options, bootstrapPlan, releaseVersion, packageSpecs),
    ...emitScaffoldFilesForPlan(options, bootstrapPlan),
  ];
}

/**
 * Scaffolds a new fluo application into the target directory.
 *
 * @param options Bootstrap configuration for the new project.
 * @param importMetaUrl Optional URL of the importing module for relative path resolution.
 * @returns A promise that resolves when the project has been scaffolded.
 */
export async function scaffoldBootstrapApp(
  options: BootstrapOptions,
  importMetaUrl = import.meta.url,
): Promise<void> {
  const targetDirectory = resolve(options.targetDirectory);
  const releaseVersion = readOwnPackageVersion(importMetaUrl);
  const bootstrapPlan = resolveBootstrapPlan(options);
  const packageSpecs = await resolvePackageSpecs(options, bootstrapPlan);

  mkdirSync(targetDirectory, { recursive: true });

  if (!options.force) {
    const existingFiles = readdirSync(targetDirectory);
    if (existingFiles.length > 0) {
      throw new Error(
        `Target directory "${targetDirectory}" is not empty. ` +
        'Remove the existing files or use --force to overwrite.',
      );
    }
  }

  for (const file of buildScaffoldFiles(options, bootstrapPlan, releaseVersion, packageSpecs)) {
    writeTextFile(join(targetDirectory, file.path), file.content);
  }

  if (options.initializeGit) {
    await initializeGitRepository(targetDirectory);
  }

  if (options.installDependencies ?? !options.skipInstall) {
    await installDependencies(targetDirectory, options.packageManager);
  }
}

function runPackCommand(repoRoot: string, packageDirectory: string, outputDirectory: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('npm', ['pack', '--pack-destination', outputDirectory], {
      cwd: join(repoRoot, 'packages', packageDirectory),
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`Failed to pack ${packageDirectory} with exit code ${code}.`));
    });
  });
}

function runWorkspaceBuild(repoRoot: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('pnpm', ['build'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`Failed to build workspace with exit code ${code}.`));
    });
  });
}

function expectedTarballName(packageName: string, version: string): string {
  return `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

function readLocalPackageVersion(repoRoot: string, packageName: LocalPackageName): string {
  const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, 'packages', packageDirectory, 'package.json'), 'utf8'),
  ) as { version: string };

  return packageJson.version;
}

function readLocalPackageManifest(
  repoRoot: string,
  packageName: LocalPackageName,
): {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
  return JSON.parse(
    readFileSync(join(repoRoot, 'packages', packageDirectory, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}

function collectRequiredLocalPackages(
  repoRoot: string,
  bootstrapPlan: ResolvedBootstrapPlan,
): readonly LocalPackageName[] {
  const pending = [
    ...bootstrapPlan.dependencies.dependencies,
    ...bootstrapPlan.dependencies.devDependencies,
  ].filter((packageName): packageName is LocalPackageName => packageName in PACKAGE_DIRECTORY_BY_NAME);
  const selected = new Set<LocalPackageName>();

  while (pending.length > 0) {
    const packageName = pending.pop();

    if (!packageName || selected.has(packageName)) {
      continue;
    }

    selected.add(packageName);
    const manifest = readLocalPackageManifest(repoRoot, packageName);

    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      const dependencies = manifest[section];

      if (!dependencies) {
        continue;
      }

      for (const dependencyName of Object.keys(dependencies)) {
        if (dependencyName in PACKAGE_DIRECTORY_BY_NAME) {
          pending.push(dependencyName as LocalPackageName);
        }
      }
    }
  }

  return Array.from(selected);
}

function collectLocalPackageVersions(repoRoot: string, packageNames: readonly LocalPackageName[]): Map<LocalPackageName, string> {
  const packageVersions = new Map<LocalPackageName, string>();

  for (const packageName of packageNames) {
    packageVersions.set(packageName, readLocalPackageVersion(repoRoot, packageName));
  }

  return packageVersions;
}

function getPackageVersionOrThrow(
  packageVersions: ReadonlyMap<LocalPackageName, string>,
  packageName: LocalPackageName,
): string {
  const packageVersion = packageVersions.get(packageName);

  if (!packageVersion) {
    throw new Error(`Unable to determine version for ${packageName}.`);
  }

  return packageVersion;
}

function toPackageVersionRecord(
  packageVersions: ReadonlyMap<LocalPackageName, string>,
): Partial<Record<LocalPackageName, string>> {
  const packageVersionRecord: Partial<Record<LocalPackageName, string>> = {};

  for (const [packageName, packageVersion] of packageVersions.entries()) {
    packageVersionRecord[packageName] = packageVersion;
  }

  return packageVersionRecord;
}

function runGitCommand(repoRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function createPackagePathArguments(packageNames: readonly LocalPackageName[]): string[] {
  const packagePaths = new Set<string>();

  for (const packageName of packageNames) {
    const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
    const packageRoot = join('packages', packageDirectory);
    packagePaths.add(packageRoot);
    packagePaths.add(join(packageRoot, 'src'));
    packagePaths.add(join(packageRoot, 'package.json'));
    packagePaths.add(join(packageRoot, 'tsconfig.json'));
    packagePaths.add(join(packageRoot, 'tsconfig.build.json'));
  }

  return Array.from(packagePaths);
}

function computeLocalPackageCacheStamp(
  repoRoot: string,
  packageNames: readonly LocalPackageName[],
  packageVersions: ReadonlyMap<LocalPackageName, string>,
): LocalPackageCacheStamp | undefined {
  const headCommit = runGitCommand(repoRoot, ['rev-parse', 'HEAD']);

  if (!headCommit) {
    return undefined;
  }

  const packagePaths = createPackagePathArguments(packageNames);
  const dirtyFingerprint = runGitCommand(repoRoot, ['status', '--porcelain', '--', ...packagePaths]);

  if (dirtyFingerprint === undefined) {
    return undefined;
  }

  return {
    dirtyFingerprint,
    headCommit,
    packageVersions: toPackageVersionRecord(packageVersions),
  };
}

function readLocalPackageCacheStamp(stampPath: string): LocalPackageCacheStamp | undefined {
  if (!existsSync(stampPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(stampPath, 'utf8')) as LocalPackageCacheStamp;
  } catch {
    return undefined;
  }
}

function cacheStampMatches(expected: LocalPackageCacheStamp, actual: LocalPackageCacheStamp | undefined): boolean {
  if (!actual) {
    return false;
  }

  if (actual.headCommit !== expected.headCommit || actual.dirtyFingerprint !== expected.dirtyFingerprint) {
    return false;
  }

  for (const [packageName, packageVersion] of Object.entries(expected.packageVersions) as [LocalPackageName, string][]) {
    if (actual.packageVersions[packageName] !== packageVersion) {
      return false;
    }
  }

  return true;
}

function cacheContainsTarballs(
  outputDirectory: string,
  packageNames: readonly LocalPackageName[],
  packageVersions: ReadonlyMap<LocalPackageName, string>,
): boolean {
  const packedFiles = new Set(readdirSync(outputDirectory));

  return packageNames.every((packageName) => {
    const packageVersion = getPackageVersionOrThrow(packageVersions, packageName);
    const tarball = expectedTarballName(packageName, packageVersion);
    return packedFiles.has(tarball);
  });
}

function createLocalPackageCachePath(repoRoot: string): string {
  const repoCacheKey = createHash('sha1').update(resolve(repoRoot)).digest('hex').slice(0, 12);
  return join(LOCAL_PACKAGE_CACHE_DIR, repoCacheKey);
}

function latestModifiedTimeMs(path: string): number {
  const stats = statSync(path);

  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  let latest = stats.mtimeMs;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    latest = Math.max(latest, latestModifiedTimeMs(entryPath));
  }

  return latest;
}

function packageHasOutdatedBuildOutput(repoRoot: string, packageName: LocalPackageName): boolean {
  const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
  const packageRoot = join(repoRoot, 'packages', packageDirectory);
  const distDirectory = join(packageRoot, 'dist');

  if (!existsSync(distDirectory)) {
    return true;
  }

  const sourceCandidates = [
    join(packageRoot, 'src'),
    join(packageRoot, 'package.json'),
    join(packageRoot, 'tsconfig.json'),
    join(packageRoot, 'tsconfig.build.json'),
  ];
  let latestSource = 0;

  for (const sourceCandidate of sourceCandidates) {
    if (!existsSync(sourceCandidate)) {
      continue;
    }

    latestSource = Math.max(latestSource, latestModifiedTimeMs(sourceCandidate));
  }

  const latestDist = latestModifiedTimeMs(distDirectory);
  return latestDist < latestSource;
}

function shouldRunWorkspaceBuild(repoRoot: string, packageNames: readonly LocalPackageName[]): boolean {
  return packageNames.some((packageName) => packageHasOutdatedBuildOutput(repoRoot, packageName));
}

async function ensureWorkspaceBuildOutput(repoRoot: string, packageNames: readonly LocalPackageName[]): Promise<void> {
  if (shouldRunWorkspaceBuild(repoRoot, packageNames)) {
    await runWorkspaceBuild(repoRoot);
  }
}

async function packLocalPackages(
  repoRoot: string,
  outputDirectory: string,
  packageNames: readonly LocalPackageName[],
  packageVersions: ReadonlyMap<LocalPackageName, string>,
): Promise<void> {
  for (const packageName of packageNames) {
    const packageVersion = getPackageVersionOrThrow(packageVersions, packageName);
    const tarballName = expectedTarballName(packageName, packageVersion);

    await runPackCommand(repoRoot, PACKAGE_DIRECTORY_BY_NAME[packageName], outputDirectory);
    await normalizePackedPackageManifest(outputDirectory, tarballName, packageVersions);
  }
}

function createLocalTarballSpecs(
  outputDirectory: string,
  packageNames: readonly LocalPackageName[],
  packageVersions: ReadonlyMap<LocalPackageName, string>,
): Record<string, string> {
  const packedFiles = new Set(readdirSync(outputDirectory));
  const tarballs = new Map<string, string>();

  for (const packageName of packageNames) {
    const packageVersion = getPackageVersionOrThrow(packageVersions, packageName);
    const tarball = expectedTarballName(packageName, packageVersion);

    if (!packedFiles.has(tarball)) {
      throw new Error(`Unable to locate packed tarball for ${packageName}.`);
    }

    tarballs.set(packageName, `file:${join(outputDirectory, tarball)}`);
  }

  return Object.fromEntries(tarballs);
}

function rewriteWorkspaceProtocolDependencies(
  manifest: {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  },
  packageVersions: ReadonlyMap<string, string>,
): void {
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const dependencies = manifest[section];

    if (!dependencies) {
      continue;
    }

    for (const [packageName, specifier] of Object.entries(dependencies)) {
      if (!specifier.startsWith('workspace:')) {
        continue;
      }

      const version = packageVersions.get(packageName);

      if (!version) {
        continue;
      }

      dependencies[packageName] = `^${version}`;
    }
  }
}

function runTarCommand(args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar', args, {
      cwd,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`tar ${args.join(' ')} failed with exit code ${code}.`));
    });
  });
}

async function normalizePackedPackageManifest(
  outputDirectory: string,
  tarballName: string,
  packageVersions: ReadonlyMap<string, string>,
): Promise<void> {
  const tarballPath = join(outputDirectory, tarballName);
  const temporaryDirectory = join(outputDirectory, `.tmp-${tarballName.replace(/\.tgz$/, '')}`);
  const packageJsonPath = join(temporaryDirectory, 'package', 'package.json');

  rmSync(temporaryDirectory, { force: true, recursive: true });
  mkdirSync(temporaryDirectory, { recursive: true });

  await runTarCommand(['-xzf', tarballPath, '-C', temporaryDirectory], outputDirectory);

  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  rewriteWorkspaceProtocolDependencies(manifest, packageVersions);
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  rmSync(tarballPath, { force: true });
  await runTarCommand(['-czf', tarballPath, '-C', temporaryDirectory, 'package'], outputDirectory);
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

async function resolvePackageSpecs(
  options: BootstrapOptions,
  bootstrapPlan: ResolvedBootstrapPlan,
): Promise<Record<string, string>> {
  if (options.dependencySource !== 'local' || !options.repoRoot) {
    return {};
  }

  const repoRoot = resolve(options.repoRoot);
  const outputDirectory = createLocalPackageCachePath(repoRoot);
  const cacheStampPath = join(outputDirectory, LOCAL_PACKAGE_CACHE_STAMP_FILE);
  mkdirSync(outputDirectory, { recursive: true });

  void bootstrapPlan;

  const packageNames = collectRequiredLocalPackages(repoRoot, bootstrapPlan);
  const packageVersions = collectLocalPackageVersions(repoRoot, packageNames);
  const expectedCacheStamp = computeLocalPackageCacheStamp(repoRoot, packageNames, packageVersions);
  const currentCacheStamp = readLocalPackageCacheStamp(cacheStampPath);
  const canReuseCachedTarballs = expectedCacheStamp
    ? cacheStampMatches(expectedCacheStamp, currentCacheStamp)
      && cacheContainsTarballs(outputDirectory, packageNames, packageVersions)
    : false;

  if (!canReuseCachedTarballs) {
    await ensureWorkspaceBuildOutput(repoRoot, packageNames);
    await packLocalPackages(repoRoot, outputDirectory, packageNames, packageVersions);

    if (expectedCacheStamp) {
      writeFileSync(cacheStampPath, `${JSON.stringify(expectedCacheStamp, null, 2)}\n`, 'utf8');
    } else {
      rmSync(cacheStampPath, { force: true });
    }
  }

  return createLocalTarballSpecs(outputDirectory, packageNames, packageVersions);
}

/**
 * Alias for {@link scaffoldBootstrapApp}.
 */
export const scaffoldFluoApp = scaffoldBootstrapApp;
