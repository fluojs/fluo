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
const contractOwners = [
  'docs/contracts/health-and-readiness.md',
  'docs/contracts/health-and-readiness.ko.md',
] as const;
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
  it.each(contractOwners)('requires the canonical Docs sentinel in %s', (owner) => {
    const readText = (path: string): string => {
      if (path === owner) return '';
      if (contractOwners.some((candidate) => candidate === path)) return contractSentinel;
      return readFileSync(join(repoRoot, path), 'utf8');
    };

    expect(() => enforceTerminusRuntimeHealthContract(readText)).toThrow(
      `${owner} must preserve the Terminus runtime health contract sentinel.`,
    );
  });

  it.each(contractOwners)('requires the other canonical owner when %s changes', (owner) => {
    const companion = contractOwners.find((candidate) => candidate !== owner);

    expect(() => enforceTerminusRuntimeHealthContractCompanions([owner])).toThrow(
      `Terminus runtime health contract updates must include ${companion}.`,
    );
  });

  it.each([
    'book/beginner/ch18-health.md',
    'book/beginner/ch18-health.ko.md',
  ])('does not promote a changed legacy Book summary into an owner: %s', (path) => {
    expect(() => enforceTerminusRuntimeHealthContractCompanions([path])).not.toThrow();
  });

  it('accepts Docs owner updates without meaningless source or guard companion churn', () => {
    expect(() => enforceTerminusRuntimeHealthContractCompanions(contractOwners)).not.toThrow();
  });

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

  it('requires companions for an ambiguous shared line even when a distant package boundary changes', () => {
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
    ).toThrow('Terminus runtime health contract updates must include');
  });

  it('leaves Node-only support policy changes to the engine and release gates', () => {
    const unchangedHealthContract = `${'x'.repeat(300)} @fluojs/terminus /health status=503`;
    const patch = [
      `- Node.js 20+ @fluojs/metrics ${unchangedHealthContract} engines.node >=20.0.0`,
      `+ Node.js \`>=24.0.0 <27\` @fluojs/metrics ${unchangedHealthContract} engines.node >=24.0.0 <27`,
    ].join('\n');

    expect(() =>
      enforceTerminusRuntimeHealthContractCompanions(['docs/CONTEXT.md'], () => patch),
    ).not.toThrow();
  });

  it('still requires companions when a Node policy update accompanies distant health drift', () => {
    const unchangedPrefix = `${'x'.repeat(300)} @fluojs/terminus /health`;
    const patch = [
      `- Node.js 20+ @fluojs/metrics ${unchangedPrefix} status=503 engines.node >=20.0.0`,
      `+ Node.js \`>=24.0.0 <27\` @fluojs/metrics ${unchangedPrefix} status=200 engines.node >=24.0.0 <27`,
    ].join('\n');

    expect(() =>
      enforceTerminusRuntimeHealthContractCompanions(['docs/CONTEXT.md'], () => patch),
    ).toThrow('Terminus runtime health contract updates must include');
  });

  it('requires missing companions when a readiness assertion changes far beyond its marker', () => {
    const unchangedPrefix = `@fluojs/terminus ${'x'.repeat(300)}`;

    expect(() =>
      enforceTerminusRuntimeHealthContractCompanions(
        ['docs/CONTEXT.md'],
        () => [
          `- ${unchangedPrefix} readiness admission is binary.`,
          `+ ${unchangedPrefix} readiness admission is optional.`,
        ].join('\n'),
      ),
    ).toThrow(
      'Terminus runtime health contract updates must include docs/contracts/health-and-readiness.md, docs/contracts/health-and-readiness.ko.md.',
    );
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

  it('requires Docs rather than legacy consumers when a package summary changes', () => {
    expect(() => enforceTerminusRuntimeHealthContractCompanions([
      'packages/terminus/README.md',
    ])).toThrow('Terminus runtime health contract updates must include');
    expect(() => enforceTerminusRuntimeHealthContractCompanions([
      'packages/terminus/README.md',
      ...contractOwners,
    ])).not.toThrow();
  });

  it('requires actual runtime regression evidence when the Terminus module changes', () => {
    expect(() => enforceTerminusRuntimeHealthContractCompanions([
      'packages/terminus/src/module.ts',
      ...contractOwners,
    ])).toThrow('packages/terminus/src/module.test.ts');
    expect(() => enforceTerminusRuntimeHealthContractCompanions([
      'packages/terminus/src/module.ts',
      'packages/terminus/src/module.test.ts',
      ...contractOwners,
    ])).not.toThrow();
  });

  it.each([
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
  ])('accepts shared health updates backed by the Docs owner pair in %s', (path) => {
    expect(() => enforceTerminusRuntimeHealthContractCompanions(
      [path, ...contractOwners],
      () => '- /health status=200\n+ /health status=503',
    )).not.toThrow();
  });

  it('does not read shared-document patches after an authoritative path triggers companion enforcement', () => {
    const completeCompanions = [
      ...contractOwners,
      ...governedSurfaces,
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
