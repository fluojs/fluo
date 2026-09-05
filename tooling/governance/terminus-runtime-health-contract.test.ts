import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type TerminusContractGuard = {
  enforceTerminusRuntimeHealthContract: (readText?: (path: string) => string) => void;
  enforceTerminusRuntimeHealthContractCompanions: (
    changedFiles: readonly string[],
    readChangedPatch?: (path: string) => string,
  ) => void;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const {
  enforceTerminusRuntimeHealthContract,
  enforceTerminusRuntimeHealthContractCompanions,
} = (await import('./verify-platform-consistency-governance.mjs')) as unknown as TerminusContractGuard;
const contractSentinel =
  'fluo-terminus-contract: registration=application-owned-TerminusModule.forRoot;health=aggregated-diagnostics;ready-admission=binary;ready-body=ready|starting|unavailable;default-liveness=absent;unhealthy-status=503;route-protection=path-scoped-external-boundary;indicator-readiness=opt-out;readiness-checks=additive';
const governedSurfaces = [
  'packages/terminus/README.md',
  'packages/terminus/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'book/beginner/ch18-health.md',
  'book/beginner/ch18-health.ko.md',
] as const;

describe('Terminus runtime health contract governance', () => {
  it('governs every Terminus contract surface and invokes the central guard', () => {
    expect(() => enforceTerminusRuntimeHealthContract()).not.toThrow();
    expect(
      readFileSync(join(repoRoot, 'tooling/governance/verify-platform-consistency-governance.mjs'), 'utf8'),
    ).toContain('enforceTerminusRuntimeHealthContract();');
  });

  it.each(governedSurfaces)('rejects a removed contract sentinel in %s', (path) => {
    const readText = (relativePath: string): string => {
      const content = readFileSync(join(repoRoot, relativePath), 'utf8');

      return relativePath === path ? content.replace(contractSentinel, '') : content;
    };

    expect(() => enforceTerminusRuntimeHealthContract(readText)).toThrow(
      `${path} must preserve the Terminus runtime health contract sentinel.`,
    );
  });

  it.each([
    [
      "statusCode: reportWithPlatform.status === 'ok' ? 200 : 503",
      "statusCode: reportWithPlatform.status === 'ok' ? 200 : 200",
      'unhealthy HTTP 503 behavior',
    ],
    [
      'healthModule.addReadinessCheck(check);',
      'healthModule.addReadinessCheck(() => true);',
      'binary readiness behavior',
    ],
    [
      'healthModule.addReadinessCheck(check);',
      'healthModule.addReadinessCheck(check);\n    healthModule.addLivenessCheck(check);',
      'default liveness route',
    ],
  ])('rejects changed Terminus runtime %s', (source, replacement, expectedMessage) => {
    const readText = (relativePath: string): string => {
      const content = readFileSync(join(repoRoot, relativePath), 'utf8');

      return relativePath === 'packages/terminus/src/module.ts' ? content.replace(source, replacement) : content;
    };

    expect(() => enforceTerminusRuntimeHealthContract(readText)).toThrow(expectedMessage);
  });

  it('rejects comment and dead-code decoys for the unhealthy status contract', () => {
    const readText = (relativePath: string): string => {
      const content = readFileSync(join(repoRoot, relativePath), 'utf8');
      if (relativePath !== 'packages/terminus/src/module.ts') {
        return content;
      }

      return content
        .replace(
          "statusCode: reportWithPlatform.status === 'ok' ? 200 : 503",
          'statusCode: 200',
        )
        .concat(`
// statusCode: reportWithPlatform.status === 'ok' ? 200 : 503
function unusedHealthResponse(reportWithPlatform: { status: string }) {
  if (false) {
    return {
      statusCode: reportWithPlatform.status === 'ok' ? 200 : 503,
    };
  }
}
`);
    };

    expect(() => enforceTerminusRuntimeHealthContract(readText)).toThrow(
      'unhealthy HTTP 503 behavior',
    );
  });

  it('accepts an equivalent unhealthy status conditional', () => {
    const readText = (relativePath: string): string => {
      const content = readFileSync(join(repoRoot, relativePath), 'utf8');

      return relativePath === 'packages/terminus/src/module.ts'
        ? content.replace(
          "statusCode: reportWithPlatform.status === 'ok' ? 200 : 503",
          "statusCode: reportWithPlatform.status !== 'ok' ? 503 : 200",
        )
        : content;
    };

    expect(() => enforceTerminusRuntimeHealthContract(readText)).not.toThrow();
  });

  it.each([
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
  ])('ignores unrelated edits to shared document %s', (changedPath) => {
    expect(() =>
      enforceTerminusRuntimeHealthContractCompanions(
        [changedPath],
        () => '+ unrelated shared-document change',
      ),
    ).not.toThrow();
  });

  it('ignores a long shared-document line when only a distant package boundary changes', () => {
    const unchangedTerminusFragment =
      '`@fluojs/terminus` keeps `/health`, `/ready`, and TerminusModule behavior unchanged.';

    expect(() =>
      enforceTerminusRuntimeHealthContractCompanions(
        ['docs/CONTEXT.md'],
        () => [
          `- runtime uses @fluojs/runtime/node ${'x'.repeat(300)} ${unchangedTerminusFragment}`,
          `+ runtime uses @fluojs/platform-nodejs ${'x'.repeat(300)} ${unchangedTerminusFragment}`,
        ].join('\n'),
      ),
    ).not.toThrow();
  });

  it('requires companions when a shared document changes the Terminus sentinel', () => {
    expect(() =>
      enforceTerminusRuntimeHealthContractCompanions(
        ['docs/CONTEXT.md'],
        () => `- ${contractSentinel}\n+ fluo-terminus-contract: changed`,
      ),
    ).toThrow('Terminus runtime health contract updates must include');
  });

  it('requires companions when the authoritative Terminus runtime module changes', () => {
    expect(() =>
      enforceTerminusRuntimeHealthContractCompanions([
        'packages/terminus/src/module.ts',
      ]),
    ).toThrow('Terminus runtime health contract updates must include');
  });

  it('requires all governed documents and focused guard files as companions', () => {
    const completeCompanions = [
      ...governedSurfaces,
      'tooling/governance/terminus-runtime-health-contract.mjs',
      'tooling/governance/terminus-runtime-health-source-contract.mjs',
      'tooling/governance/terminus-runtime-health-contract.test.ts',
    ];

    expect(() => enforceTerminusRuntimeHealthContractCompanions([
      'packages/terminus/README.md',
    ])).toThrow('Terminus runtime health contract updates must include');
    expect(() => enforceTerminusRuntimeHealthContractCompanions(completeCompanions)).not.toThrow();
  });

  it('does not read shared-document patches after an authoritative path triggers companion enforcement', () => {
    const completeCompanions = [
      ...governedSurfaces,
      'tooling/governance/terminus-runtime-health-contract.mjs',
      'tooling/governance/terminus-runtime-health-source-contract.mjs',
      'tooling/governance/terminus-runtime-health-contract.test.ts',
    ];

    expect(() =>
      enforceTerminusRuntimeHealthContractCompanions(
        completeCompanions,
        () => {
          throw new Error('shared-document patches are unavailable in this checkout');
        },
      ),
    ).not.toThrow();
  });
});
