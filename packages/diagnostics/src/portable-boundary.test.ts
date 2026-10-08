import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const loaderPath = fileURLToPath(new URL('./reject-builtins.test-fixture.mjs', import.meta.url));

describe('published diagnostics portability', () => {
  it('imports every public entry without host builtins metadata installation or resources', async () => {
    const consumer = mkdtempSync(join(tmpdir(), 'fluo-diagnostics-'));
    try {
      const installed = join(consumer, 'node_modules/@fluojs/diagnostics');
      mkdirSync(installed, { recursive: true });
      cpSync(join(packageRoot, 'package.json'), join(installed, 'package.json'));
      cpSync(join(packageRoot, 'dist'), join(installed, 'dist'), { recursive: true });

      const result = await execFileAsync(process.execPath, [
        `--experimental-loader=${loaderPath}`,
        '--input-type=module',
        '--eval',
        `
        const metadata = Symbol.metadata;
        const forbidden = () => { throw new Error('Import acquired a resource'); };
        globalThis.setTimeout = forbidden;
        globalThis.setInterval = forbidden;
        globalThis.fetch = forbidden;
        for (const entry of ['@fluojs/diagnostics', '@fluojs/diagnostics/platform-contract', '@fluojs/diagnostics/studio-contracts']) {
          await import(entry);
        }
        if (Symbol.metadata !== metadata) throw new Error('Import installed metadata');
        `,
      ], { cwd: consumer, timeout: 30_000 });

      expect(result.stdout).toBe('');
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  });

  it('typechecks deployed declarations without runtime core DI or Studio installed', async () => {
    const consumer = mkdtempSync(join(tmpdir(), 'fluo-diagnostics-types-'));
    try {
      const installed = join(consumer, 'node_modules/@fluojs/diagnostics');
      mkdirSync(installed, { recursive: true });
      cpSync(join(packageRoot, 'package.json'), join(installed, 'package.json'));
      cpSync(join(packageRoot, 'dist'), join(installed, 'dist'), { recursive: true });
      writeFileSync(join(consumer, 'consumer.ts'), `
        import type { RuntimeDiagnosticsGraph, PlatformStatusSnapshot, StudioRouteDescriptor, StudioNormalizedRouteDescriptor } from '@fluojs/diagnostics';
        import type { PlatformHealthReport } from '@fluojs/diagnostics/platform-contract';
        import type { StudioLiveEvent } from '@fluojs/diagnostics/studio-contracts';
        type Assert<T extends true> = T;
        type OptionalWire = Assert<undefined extends StudioRouteDescriptor['params'] ? true : false>;
        type RequiredOutput = Assert<undefined extends StudioNormalizedRouteDescriptor['params'] ? false : true>;
        interface Details { dependencies: readonly string[]; [key: string]: unknown; }
        declare const status: PlatformStatusSnapshot<Details>;
        const dependencies: readonly string[] = status.details.dependencies;
        declare const graph: RuntimeDiagnosticsGraph;
        const scope: 'singleton' | 'request' | 'transient' = graph.modules[0].providers[0].scope;
        declare const health: PlatformHealthReport;
        declare const event: StudioLiveEvent;
      `);

      const result = await execFileAsync(process.execPath, [
        fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)),
        '--strict', '--noEmit', '--module', 'ESNext', '--moduleResolution', 'Bundler',
        '--target', 'ES2022', 'consumer.ts',
      ], { cwd: consumer, timeout: 30_000 });

      expect(result.stdout).toBe('');
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  });
});
