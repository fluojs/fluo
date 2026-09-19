import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  CronDistributedOptions,
  CronModuleOptions,
  CronScheduler,
  DynamicCronTaskOptions,
  DynamicIntervalTaskOptions,
  DynamicTimeoutTaskOptions,
  SchedulingRegistry,
} from './index.js';
import * as cron from './index.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRootPath = join(packageRoot, 'src/index.ts');
const declarationRootPath = join(packageRoot, 'dist/index.d.ts');

function compilePackageConsumer(source: string, useDist = false): readonly ts.Diagnostic[] {
  const fixture = join(packageRoot, 'public-surface-consumer.ts');
  const targetPath = useDist && existsSync(declarationRootPath) ? declarationRootPath : sourceRootPath;
  const options: ts.CompilerOptions = {
    baseUrl: packageRoot,
    ignoreDeprecations: '6.0',
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    paths: {
      '@fluojs/cron': [targetPath],
    },
    strict: true,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : orig(path, languageVersion, onError, shouldCreateNewSourceFile);

  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host));
}

describe('@fluojs/cron root barrel public surface', () => {
  it('keeps CronModule.forRoot as the canonical root entrypoint', () => {
    expect(cron).toHaveProperty('Cron');
    expect(cron).toHaveProperty('Interval');
    expect(cron).toHaveProperty('Timeout');
    expect(cron).toHaveProperty('CronExpression');
    expect(cron).toHaveProperty('CronModule');
    expect((cron as { CronModule: { forRoot: unknown } }).CronModule).toHaveProperty('forRoot');
    expect(cron).not.toHaveProperty('createCronModule');
    expect(cron).not.toHaveProperty('createCronProviders');
    expect(cron).toHaveProperty('SCHEDULING_REGISTRY');
    expect(cron).not.toHaveProperty('CRON_OPTIONS');
    expect(cron).toHaveProperty('createCronPlatformStatusSnapshot');
    expect(cron).not.toHaveProperty('normalizeCronModuleOptions');
    expect(cron).not.toHaveProperty('defineSchedulingTaskMetadata');
    expect(cron).not.toHaveProperty('defineCronTaskMetadata');
    expect(cron).not.toHaveProperty('getCronTaskMetadata');
    expect(cron).not.toHaveProperty('getCronTaskMetadataEntries');
    expect(cron).not.toHaveProperty('cronMetadataSymbol');
    expect(Object.keys(cron).sort()).toMatchSnapshot();
  });

  it('provides type assertions for public contracts, object-only distributed, and dynamic options', () => {
    // CronScheduler is exported from root
    expectTypeOf<CronScheduler>().toBeFunction();

    // Dynamic options reject name
    expectTypeOf<DynamicCronTaskOptions>().not.toHaveProperty('name');
    expectTypeOf<DynamicIntervalTaskOptions>().not.toHaveProperty('name');
    expectTypeOf<DynamicTimeoutTaskOptions>().not.toHaveProperty('name');
    expectTypeOf<{ name: string }>().not.toMatchTypeOf<DynamicCronTaskOptions>();
    expectTypeOf<{ name: string }>().not.toMatchTypeOf<DynamicIntervalTaskOptions>();
    expectTypeOf<{ name: string }>().not.toMatchTypeOf<DynamicTimeoutTaskOptions>();

    // SchedulingRegistry add methods use dynamic options
    expectTypeOf<Parameters<SchedulingRegistry['addCron']>[3]>().toEqualTypeOf<
      DynamicCronTaskOptions | undefined
    >();
    expectTypeOf<Parameters<SchedulingRegistry['addInterval']>[3]>().toEqualTypeOf<
      DynamicIntervalTaskOptions | undefined
    >();
    expectTypeOf<Parameters<SchedulingRegistry['addTimeout']>[3]>().toEqualTypeOf<
      DynamicTimeoutTaskOptions | undefined
    >();

    // Distributed options are object-only
    expectTypeOf<CronModuleOptions['distributed']>().toEqualTypeOf<CronDistributedOptions | undefined>();
    expectTypeOf<boolean>().not.toMatchTypeOf<NonNullable<CronModuleOptions['distributed']>>();
    expectTypeOf<true>().not.toMatchTypeOf<NonNullable<CronModuleOptions['distributed']>>();
    expectTypeOf<false>().not.toMatchTypeOf<NonNullable<CronModuleOptions['distributed']>>();
    expectTypeOf<CronDistributedOptions>().toBeObject();

    // Removed normalized internals and cron metadata aliases are not exported on the root barrel
    expectTypeOf<typeof cron>().not.toHaveProperty('normalizeCronModuleOptions');
    expectTypeOf<typeof cron>().not.toHaveProperty('defineSchedulingTaskMetadata');
    expectTypeOf<typeof cron>().not.toHaveProperty('defineCronTaskMetadata');
    expectTypeOf<typeof cron>().not.toHaveProperty('getCronTaskMetadata');
    expectTypeOf<typeof cron>().not.toHaveProperty('getCronTaskMetadataEntries');
    expectTypeOf<typeof cron>().not.toHaveProperty('cronMetadataSymbol');
  });

  it("keeps 'import type { CronScheduler } from \\'@fluojs/cron\\'' valid", () => {
    const diagnostics = compilePackageConsumer(
      "import type { CronScheduler } from '@fluojs/cron';\ntype Tested = CronScheduler;\nvoid (0 as unknown as Tested);",
    );
    expect(diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
  });

  it('rejects name in dynamic task options at compile-time', () => {
    const diagnostics = compilePackageConsumer(`
      import type { DynamicCronTaskOptions, DynamicIntervalTaskOptions, DynamicTimeoutTaskOptions } from '@fluojs/cron';
      const cronOpt: DynamicCronTaskOptions = { name: 'invalid-name' };
      const intervalOpt: DynamicIntervalTaskOptions = { name: 'invalid-name' };
      const timeoutOpt: DynamicTimeoutTaskOptions = { name: 'invalid-name' };
      void cronOpt;
      void intervalOpt;
      void timeoutOpt;
    `);
    const errorCodes = diagnostics.map((d) => d.code);
    expect(errorCodes.filter((code) => code === 2353)).toHaveLength(3);
  });

  it('rejects boolean distributed options in CronModuleOptions at compile-time', () => {
    const diagnostics = compilePackageConsumer(`
      import type { CronModuleOptions } from '@fluojs/cron';
      const optTrue: CronModuleOptions = { distributed: true };
      const optFalse: CronModuleOptions = { distributed: false };
      void optTrue;
      void optFalse;
    `);
    const errorCodes = diagnostics.map((d) => d.code);
    expect(errorCodes.filter((code) => code === 2322 || code === 2559)).toHaveLength(2);
  });

  it('rejects importing removed normalized internals and metadata helpers at compile-time', () => {
    const normalizedTypeDiagnostics = compilePackageConsumer(
      "import type { NormalizedCronModuleOptions } from '@fluojs/cron';\ntype Tested = NormalizedCronModuleOptions;\nvoid (0 as unknown as Tested);",
    );
    expect(
      normalizedTypeDiagnostics.some(
        (d) => d.code === 2724 || d.code === 2614 || d.code === 2305,
      ),
    ).toBe(true);

    const normalizedFnDiagnostics = compilePackageConsumer(
      "import { normalizeCronModuleOptions } from '@fluojs/cron';\nvoid normalizeCronModuleOptions;",
    );
    expect(
      normalizedFnDiagnostics.some(
        (d) => d.code === 2724 || d.code === 2614 || d.code === 2305,
      ),
    ).toBe(true);

    const removedMetadataDiagnostics = compilePackageConsumer(`
      import {
        defineSchedulingTaskMetadata,
        defineCronTaskMetadata,
        getCronTaskMetadata,
        getCronTaskMetadataEntries,
        cronMetadataSymbol,
      } from '@fluojs/cron';
      void defineSchedulingTaskMetadata;
      void defineCronTaskMetadata;
      void getCronTaskMetadata;
      void getCronTaskMetadataEntries;
      void cronMetadataSymbol;
    `);
    expect(
      removedMetadataDiagnostics.some(
        (d) => d.code === 2724 || d.code === 2614 || d.code === 2305,
      ),
    ).toBe(true);
  });

  it('preserves public contract validation against built declarations when present', () => {
    if (!existsSync(declarationRootPath)) {
      return;
    }

    const validDiagnostics = compilePackageConsumer(
      "import type { CronScheduler } from '@fluojs/cron';\ntype Tested = CronScheduler;\nvoid (0 as unknown as Tested);",
      true,
    );
    expect(validDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error)).toEqual([]);

    const invalidDiagnostics = compilePackageConsumer(
      `
      import type { DynamicCronTaskOptions, CronModuleOptions } from '@fluojs/cron';
      const c: DynamicCronTaskOptions = { name: 'bad' };
      const m: CronModuleOptions = { distributed: true };
      void c;
      void m;
    `,
      true,
    );
    expect(invalidDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length).toBeGreaterThan(0);
  });
});
