import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRootPath = fileURLToPath(new URL('..', import.meta.url));
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const buildClosureScriptPath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);
const requiredArtifactPaths = [
  resolve(packageRootPath, 'dist/adapter.js'),
  resolve(packageRootPath, 'dist/adapter.d.ts'),
  resolve(packageRootPath, 'dist/index.d.ts'),
] as const;

describe('@fluojs/platform-cloudflare-workers published artifacts', () => {
  beforeAll(async () => {
    if (requiredArtifactPaths.every((artifactPath) => existsSync(artifactPath))) {
      return;
    }

    await execFileAsync(process.execPath, [buildClosureScriptPath, '@fluojs/platform-cloudflare-workers'], {
      cwd: repoRootPath,
      env: process.env,
    });
  }, 300_000);

  it('keeps the manifest-exported runtime aligned with the Worker lifecycle contract', () => {
    // Given: the package manifest publishes its root runtime from dist/index.js.
    const manifest: unknown = JSON.parse(readFileSync(resolve(packageRootPath, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      exports: {
        '.': {
          import: './dist/index.js',
        },
      },
    });

    // When: the generated runtime artifact is inspected.
    const runtimeArtifact = readFileSync(resolve(packageRootPath, 'dist/adapter.js'), 'utf8');

    // Then: it contains the request context, binding freeze, streaming drain, and timeout recovery behavior.
    expect(runtimeArtifact).toContain('frameworkRequest.cloudflare = {');
    expect(runtimeArtifact).toContain('Cloudflare Workers websocket binding must be configured before listen()');
    expect(runtimeArtifact).toContain('createWebSocketCloseLifecycle');
    expect(runtimeArtifact).toContain('createLifecycleTrackedResponse');
    expect(runtimeArtifact).toContain('watchTimedOutCloseRecovery');
  });

  it('keeps the manifest-exported declarations aligned with the Worker public seam', () => {
    // Given: the package manifest publishes its root declarations from dist/index.d.ts.
    const manifest: unknown = JSON.parse(readFileSync(resolve(packageRootPath, 'package.json'), 'utf8'));

    expect(manifest).toMatchObject({
      exports: {
        '.': {
          types: './dist/index.d.ts',
        },
      },
    });

    // When: the generated declaration artifacts are inspected.
    const rootDeclaration = readFileSync(resolve(packageRootPath, 'dist/index.d.ts'), 'utf8');
    const adapterDeclaration = readFileSync(resolve(packageRootPath, 'dist/adapter.d.ts'), 'utf8');

    // Then: the root reaches the current request context and lifecycle declarations.
    expect(rootDeclaration).toContain("export * from './adapter.js';");
    expect(adapterDeclaration).toContain('export interface CloudflareWorkerRequestContext<Env = unknown>');
    expect(adapterDeclaration).toContain('readonly env: Env;');
    expect(adapterDeclaration).toContain('readonly executionContext?: CloudflareWorkerExecutionContext;');
    expect(adapterDeclaration).toContain('private isWebSocketBindingFrozen;');
    expect(adapterDeclaration).toContain('private createRequestResponseFactory;');
  });
});
