import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as testing from './index.js';
import * as http from './http.js';
import * as mock from './mock.js';
import * as portability from './portability/http-adapter-portability.js';
import * as webPortability from './portability/web-runtime-adapter-portability.js';
import * as conformance from './conformance/platform-conformance.js';
import * as fetchStyleWebsocket from './conformance/fetch-style-websocket-conformance.js';

const packageRoot = new URL('..', import.meta.url);
const packageRootPath = fileURLToPath(packageRoot);
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const packageJsonPath = new URL('../package.json', import.meta.url);
const emittedHarnessSubpaths = [
  './platform-conformance',
  './http-adapter-portability',
  './web-runtime-adapter-portability',
  './fetch-style-websocket-conformance',
] as const;

async function runBuild(): Promise<void> {
  const scriptPath = fileURLToPath(new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url));

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [scriptPath, '@fluojs/testing'], {
      cwd: repoRootPath,
      env: process.env,
      stdio: 'pipe',
    });
    const childEvents = child as unknown as NodeJS.EventEmitter;

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    void once(childEvents, 'error').then(([error]) => {
      reject(error);
    });

    void once(childEvents, 'exit').then(([code, signal]) => {
      expect(code, [stdout, stderr, signal ? `signal: ${signal}` : ''].filter(Boolean).join('\n')).toBe(0);
      resolvePromise();
    });
  });
}

describe('@fluojs/testing surface', () => {
  it('keeps the root barrel focused on module/app helpers', () => {
    expect(testing.createTestingModule).toBeTypeOf('function');
    expect(testing.createTestApp).toBeTypeOf('function');
    expect(testing.extractModuleProviders).toBeTypeOf('function');
    expect('createMock' in testing).toBe(false);
    expect('makeRequest' in testing).toBe(false);
    expect('createPlatformConformanceHarness' in testing).toBe(false);
    expect('createHttpAdapterPortabilityHarness' in testing).toBe(false);
    expect('createWebRuntimeHttpAdapterPortabilityHarness' in testing).toBe(false);
    expect('createFetchStyleWebSocketConformanceHarness' in testing).toBe(false);
  });

  it('exposes responsibility-specific helpers from subpaths', () => {
    expect(mock.createMock).toBeTypeOf('function');
    expect(mock.createDeepMock).toBeTypeOf('function');
    expect(mock.mockToken).toBeTypeOf('function');
    expect(http.makeRequest).toBeTypeOf('function');
    expect(conformance.createPlatformConformanceHarness).toBeTypeOf('function');
    expect(portability.createHttpAdapterPortabilityHarness).toBeTypeOf('function');
    expect(webPortability.createWebRuntimeHttpAdapterPortabilityHarness).toBeTypeOf('function');
    expect(fetchStyleWebsocket.createFetchStyleWebSocketConformanceHarness).toBeTypeOf('function');
  });

  it('keeps published subpath metadata aligned with the built surface', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports: Record<string, { import: string; types: string }>;
      peerDependencies: Record<string, string>;
      peerDependenciesMeta?: Record<string, unknown>;
    };

    expect(packageJson.exports['./platform-conformance']).toEqual({
      types: './dist/conformance/platform-conformance.d.ts',
      import: './dist/conformance/platform-conformance.js',
    });
    expect(packageJson.exports['./http-adapter-portability']).toEqual({
      types: './dist/portability/http-adapter-portability.d.ts',
      import: './dist/portability/http-adapter-portability.js',
    });
    expect(packageJson.exports['./web-runtime-adapter-portability']).toEqual({
      types: './dist/portability/web-runtime-adapter-portability.d.ts',
      import: './dist/portability/web-runtime-adapter-portability.js',
    });
    expect(packageJson.exports['./fetch-style-websocket-conformance']).toEqual({
      types: './dist/conformance/fetch-style-websocket-conformance.d.ts',
      import: './dist/conformance/fetch-style-websocket-conformance.js',
    });
    expect(packageJson.peerDependencies['@babel/core']).toBe('>=7.0.0');
    expect(packageJson.peerDependencies.vitest).toBe('^3.0.8');
    expect(packageJson.peerDependenciesMeta?.['@babel/core']).toBeUndefined();
    expect(readFileSync(resolve(packageRootPath, 'README.md'), 'utf8')).toContain('npm install --save-dev @babel/core');
    expect(readFileSync(resolve(packageRootPath, 'README.ko.md'), 'utf8')).toContain('pnpm add -D @babel/core');
  });

  it('documents the testing module identity contract in both README mirrors', () => {
    const englishReadme = readFileSync(resolve(packageRootPath, 'README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(packageRootPath, 'README.ko.md'), 'utf8');

    expect(englishReadme).toContain('`createTestingModule({ rootModule })` requires an explicit root module');
    expect(englishReadme).toContain('preserves the original `rootModule` and compiled `modules[].type` identities');
    expect(koreanReadme).toContain('`createTestingModule({ rootModule })`에는 명시적인 루트 모듈이 필요합니다');
    expect(koreanReadme).toContain('원래 `rootModule`과 컴파일된 `modules[].type` identity를 보존합니다');
  });

  it('build emits the published harness subpath files without blocking the Vitest worker event loop', async () => {
    await runBuild();

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports: Record<string, { import: string; types: string }>;
    };

    for (const subpath of emittedHarnessSubpaths) {
      const entry = packageJson.exports[subpath];

      expect(existsSync(resolve(packageRootPath, entry.import)), `${subpath} import output is missing`).toBe(true);
      expect(existsSync(resolve(packageRootPath, entry.types)), `${subpath} types output is missing`).toBe(true);
    }
  }, 300_000);
});
