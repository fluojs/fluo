import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scaffoldBootstrapApp } from './scaffold.js';
import { DEFAULT_BOOTSTRAP_SCHEMA } from './resolver.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function readDirectorySnapshot(rootDirectory: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const pending = [rootDirectory];

  while (pending.length > 0) {
    const currentDirectory = pending.pop();

    if (!currentDirectory) {
      continue;
    }

    for (const entry of readdirSync(currentDirectory)) {
      const entryPath = join(currentDirectory, entry);
      const entryStat = statSync(entryPath);

      if (entryStat.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      snapshot[relative(rootDirectory, entryPath)] = readFileSync(entryPath, 'utf8');
    }
  }

  return snapshot;
}

describe('scaffoldBootstrapApp', () => {
  it('generates TS6 starter configs without deprecated baseUrl aliases', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory,
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tsconfig = readFileSync(join(targetDirectory, 'tsconfig.json'), 'utf8');
    const tsconfigBuild = readFileSync(join(targetDirectory, 'tsconfig.build.json'), 'utf8');
    const viteConfig = readFileSync(join(targetDirectory, 'vite.config.ts'), 'utf8');
    const vitestConfig = readFileSync(join(targetDirectory, 'vitest.config.ts'), 'utf8');

    expect(packageJson.devDependencies?.typescript).toBe('^6.0.2');
    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/http': expect.any(String),
      '@fluojs/platform-fastify': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(tsconfig).not.toContain('baseUrl');
    expect(tsconfigBuild).not.toContain('baseUrl');
    expect(viteConfig).toContain("import { defineConfig } from 'vite';");
    expect(viteConfig).not.toContain('baseUrl');
    expect(vitestConfig).toContain("import { fluoBabelDecoratorsPlugin } from '@fluojs/testing/vitest';");
    expect(vitestConfig).not.toContain('baseUrl');
  });

  it('keeps the default Node + Fastify HTTP scaffold identical when explicit shape flags are provided', async () => {
    const defaultTargetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-default-'));
    const explicitTargetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-explicit-'));
    temporaryDirectories.push(defaultTargetDirectory, explicitTargetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory: defaultTargetDirectory,
    });

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'fastify',
      projectName: 'starter-app',
      runtime: 'node',
      shape: 'application',
      skipInstall: true,
      targetDirectory: explicitTargetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    expect(readDirectorySnapshot(explicitTargetDirectory)).toEqual(readDirectorySnapshot(defaultTargetDirectory));
  });

  it('describes only the wired application starter path in generated HTTP starter output', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-http-wording-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      skipInstall: true,
      targetDirectory,
    });

    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');

    expect(readme).toContain('Starter contract: `src/main.ts` wires the selected first-class application starter: Node.js runtime + Fastify HTTP via `createFastifyAdapter(...)`');
    expect(readme).toContain('Default baseline: when you omit `--platform`, `fluo new` still generates the Node.js + Fastify HTTP starter by default');
    expect(readme).toContain('Broader runtime/adapter package coverage is documented in the fluo docs and package READMEs; this generated starter intentionally describes only the wired starter path above');
    expect(readme).not.toContain('Bun');
    expect(readme).not.toContain('Deno');
    expect(readme).not.toContain('Cloudflare');
    expect(readme).not.toContain('@fluojs/platform-nodejs');
    expect(mainFile).toContain('// The generated starter wires the selected first-class fluo new application path:');
    expect(mainFile).toContain('// Node.js runtime + Fastify HTTP via createFastifyAdapter(...).');
    expect(mainFile).not.toContain('Bun');
    expect(mainFile).not.toContain('Deno');
    expect(mainFile).not.toContain('Cloudflare');
    expect(mainFile).not.toContain('@fluojs/platform-nodejs');
  });

  it('generates the Express application starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-express-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'express',
      projectName: 'starter-express',
      runtime: 'node',
      shape: 'application',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/platform-express': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-fastify');
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-nodejs');
    expect(readme).toContain('Node.js runtime + Express HTTP via `createExpressAdapter(...)`');
    expect(mainFile).toContain("import { createExpressAdapter } from '@fluojs/platform-express';");
    expect(mainFile).toContain('adapter: createExpressAdapter({ port })');
  });

  it('generates the raw Node.js application starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-nodejs-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'nodejs',
      projectName: 'starter-nodejs',
      runtime: 'node',
      shape: 'application',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/platform-nodejs': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-fastify');
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-express');
    expect(readme).toContain('Node.js runtime + raw Node.js HTTP via `createNodejsAdapter(...)`');
    expect(mainFile).toContain("import { createNodejsAdapter } from '@fluojs/platform-nodejs';");
    expect(mainFile).toContain('adapter: createNodejsAdapter({ port })');
  });

  it('generates a runnable TCP microservice starter scaffold', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-microservice-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'none',
      projectName: 'starter-microservice',
      runtime: 'node',
      shape: 'microservice',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'tcp',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');
    const appTestFile = readFileSync(join(targetDirectory, 'src', 'app.test.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/config': expect.any(String),
      '@fluojs/microservices': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/http');
    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/platform-fastify');
    expect(readme).toContain('Shape: `microservice`');
    expect(envFile).toContain('MICROSERVICE_PORT=4000');
    expect(appFile).toContain('new TcpMicroserviceTransport({ host, port })');
    expect(mainFile).toContain('FluoFactory.createMicroservice(AppModule)');
    expect(appTestFile).toContain('InMemoryLoopbackTransport');
  });

  it('generates a mixed single-package scaffold with an attached TCP microservice', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-mixed-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      packageManager: 'pnpm',
      platform: 'fastify',
      projectName: 'starter-mixed',
      runtime: 'node',
      shape: 'mixed',
      skipInstall: true,
      targetDirectory,
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'tcp',
    });

    const packageJson = JSON.parse(readFileSync(join(targetDirectory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const readme = readFileSync(join(targetDirectory, 'README.md'), 'utf8');
    const envFile = readFileSync(join(targetDirectory, '.env'), 'utf8');
    const appFile = readFileSync(join(targetDirectory, 'src', 'app.ts'), 'utf8');
    const mainFile = readFileSync(join(targetDirectory, 'src', 'main.ts'), 'utf8');
    const appTestFile = readFileSync(join(targetDirectory, 'src', 'app.test.ts'), 'utf8');

    expect(packageJson.dependencies).toMatchObject({
      '@fluojs/http': expect.any(String),
      '@fluojs/microservices': expect.any(String),
      '@fluojs/platform-fastify': expect.any(String),
      '@fluojs/runtime': expect.any(String),
    });
    expect(packageJson.scripts).not.toHaveProperty('dev:microservice');
    expect(readme).toContain('Shape: `mixed`');
    expect(readme).toContain('attached TCP microservice');
    expect(envFile).toContain('PORT=3000');
    expect(envFile).toContain('MICROSERVICE_PORT=4000');
    expect(appFile).toContain('MicroservicesModule.forRoot');
    expect(mainFile).toContain('await app.connectMicroservice();');
    expect(mainFile).toContain('await app.startAllMicroservices();');
    expect(appTestFile).toContain('InMemoryLoopbackTransport');
    expect(readDirectorySnapshot(targetDirectory)).not.toHaveProperty('src/microservice.ts');
  });

  it('can initialize git while skipping dependency installation', async () => {
    const targetDirectory = mkdtempSync(join(tmpdir(), 'fluo-scaffold-git-'));
    temporaryDirectories.push(targetDirectory);

    await scaffoldBootstrapApp({
      ...DEFAULT_BOOTSTRAP_SCHEMA,
      initializeGit: true,
      installDependencies: false,
      packageManager: 'pnpm',
      projectName: 'starter-app',
      targetDirectory,
    });

    expect(statSync(join(targetDirectory, '.git')).isDirectory()).toBe(true);
    expect(readFileSync(join(targetDirectory, 'package.json'), 'utf8')).toContain('"name": "starter-app"');
  });
});
