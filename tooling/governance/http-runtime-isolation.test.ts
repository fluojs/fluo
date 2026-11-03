import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isFunctionDeclaration,
  isIdentifier,
  ScriptKind,
  ScriptTarget,
} from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  enforceContractCompanionUpdates,
  enforceHttpRuntimeCancellationAndContextIsolation,
} from './verify-platform-consistency-governance.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('HTTP runtime isolation governance', () => {
  it('keeps cancellation, managed SSE backpressure, request context, and fast-path scope isolation enforced', () => {
    // Given
    const verifyContract = () => enforceHttpRuntimeCancellationAndContextIsolation();

    // When / Then
    expect(verifyContract).not.toThrow();
  });

  it('invokes HTTP lifecycle routing and content gates from central governance', () => {
    // Given
    const source = createSourceFile(
      'verify-platform-consistency-governance.mjs',
      readFileSync(join(repoRoot, 'tooling/governance/verify-platform-consistency-governance.mjs'), 'utf8'),
      ScriptTarget.Latest,
      true,
      ScriptKind.JS,
    );
    const mainGateCalls = new Set<string>();

    // When
    for (const statement of source.statements) {
      if (!isFunctionDeclaration(statement) || statement.name?.text !== 'main' || statement.body === undefined) {
        continue;
      }
      forEachChild(statement.body, function visit(node): void {
        if (isCallExpression(node) && isIdentifier(node.expression)) {
          mainGateCalls.add(node.expression.text);
        }
        forEachChild(node, visit);
      });
    }

    // Then
    expect([...mainGateCalls]).toEqual(expect.arrayContaining([
      'enforceContractCompanionUpdates',
      'enforceHttpRuntimeCancellationAndContextIsolation',
    ]));
  });

  it('routes byte-range lifecycle changes to policy, dispatcher, and canonical harness evidence', () => {
    // Given
    const changedFiles = [
      'docs/architecture/http-runtime.md',
      'docs/architecture/http-runtime.ko.md',
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
      'tooling/governance/verify-platform-consistency-governance.mjs',
      'tooling/governance/verify-platform-consistency-governance.test.ts',
      'tooling/governance/http-runtime-isolation.test.ts',
      'packages/http/src/byte-range-response.ts',
      'packages/http/src/dispatch/conditional-request-policy.ts',
      'packages/http/src/dispatch/conditional-request-policy.test.ts',
      'packages/http/src/dispatch/byte-range-response.test.ts',
      'packages/testing/src/portability/http-adapter-portability.ts',
      'packages/testing/src/portability/http-adapter-portability.test.ts',
    ];

    // When
    const enforceChange = () => enforceContractCompanionUpdates(changedFiles);

    // Then: byte-range evidence is sufficient without an unrelated SSE regression.
    expect(enforceChange).not.toThrow();
  });

  it.each([
    'packages/http/src/dispatch/conditional-request-policy.test.ts',
    'packages/http/src/dispatch/byte-range-response.test.ts',
    'packages/testing/src/portability/http-adapter-portability.ts',
    'packages/testing/src/portability/http-adapter-portability.test.ts',
  ])('rejects byte-range lifecycle changes missing %s', (missingEvidence) => {
    // Given
    const changedFiles = [
      'docs/architecture/http-runtime.md',
      'docs/architecture/http-runtime.ko.md',
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
      'tooling/governance/verify-platform-consistency-governance.mjs',
      'tooling/governance/verify-platform-consistency-governance.test.ts',
      'tooling/governance/http-runtime-isolation.test.ts',
      'packages/http/src/byte-range-response.ts',
      'packages/http/src/dispatch/conditional-request-policy.ts',
      'packages/http/src/dispatch/conditional-request-policy.test.ts',
      'packages/http/src/dispatch/byte-range-response.test.ts',
      'packages/testing/src/portability/http-adapter-portability.ts',
      'packages/testing/src/portability/http-adapter-portability.test.ts',
    ].filter((path) => path !== missingEvidence);

    // When / Then
    expect(() => enforceContractCompanionUpdates(changedFiles)).toThrow(missingEvidence);
  });

  it('keeps manual-SSE evidence required for non-range lifecycle changes', () => {
    // Given
    const changedFiles = [
      'docs/architecture/http-runtime.md',
      'docs/architecture/http-runtime.ko.md',
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
      'tooling/governance/verify-platform-consistency-governance.mjs',
      'tooling/governance/verify-platform-consistency-governance.test.ts',
      'tooling/governance/http-runtime-isolation.test.ts',
    ];

    // When / Then
    expect(() => enforceContractCompanionUpdates(changedFiles)).toThrow(
      /dispatcher-manual-sse-lifecycle\.test\.ts/u,
    );
  });

  const portabilityContractPaths = [
    'docs/architecture/http-runtime.md',
    'docs/architecture/http-runtime.ko.md',
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'tooling/governance/verify-platform-consistency-governance.mjs',
    'tooling/governance/verify-platform-consistency-governance.test.ts',
    'tooling/governance/http-runtime-isolation.test.ts',
    'packages/testing/src/portability/web-runtime-adapter-portability.test.ts',
  ];
  const lifecycleHeadings = [
    'Request Lifecycle',
    'Request Context Isolation',
    'Managed SSE Backpressure Cancellation',
    'Connection Identity',
  ];
  const lifecycleDocumentation = [
    '## Byte Range Contract\nBun, Deno, Workers',
    ...lifecycleHeadings.map((heading) => `## ${heading}\nstable-${heading}`),
  ].join('\n\n');
  const portabilityDocumentation = lifecycleDocumentation.replace('Bun, Deno, Workers', 'Bun, Workers');

  it('accepts adapter inventory updates with portability evidence and unchanged lifecycle contracts', () => {
    const snapshots = Object.fromEntries(portabilityContractPaths.slice(0, 2).map((path) => [
      path,
      { base: lifecycleDocumentation, head: portabilityDocumentation },
    ]));

    expect(() => enforceContractCompanionUpdates(portabilityContractPaths, snapshots)).not.toThrow();
  });

  for (const scenario of [
    'changed lifecycle',
    'changed managed SSE',
    'missing section',
    'duplicate section',
    'missing snapshots',
    'core implementation',
  ]) {
    it(`keeps manual-SSE regression evidence mandatory for portability updates with ${scenario}`, () => {
      let head = portabilityDocumentation;
      if (scenario === 'changed lifecycle') head = head.replace('stable-Request Lifecycle', 'new-lifecycle');
      if (scenario === 'changed managed SSE') head = head.replace('stable-Managed SSE Backpressure Cancellation', 'new-sse');
      if (scenario === 'missing section') head = head.replace('## Connection Identity', '## Removed section');
      if (scenario === 'duplicate section') head += '\n\n## Request Lifecycle\nduplicate';
      const snapshots = scenario === 'missing snapshots' ? undefined : Object.fromEntries(
        portabilityContractPaths.slice(0, 2).map((path) => [path, { base: lifecycleDocumentation, head }]),
      );
      const changedFiles = scenario === 'core implementation'
        ? [...portabilityContractPaths, 'packages/runtime/src/request-transaction.ts']
        : portabilityContractPaths;

      expect(() => enforceContractCompanionUpdates(changedFiles, snapshots)).toThrow(
        /dispatcher-manual-sse-lifecycle\.test\.ts/u,
      );
    });
  }

  it('admits manual-SSE lifecycle changes with their executable regression', () => {
    // Given
    const changedFiles = [
      'docs/architecture/http-runtime.md',
      'docs/architecture/http-runtime.ko.md',
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
      'tooling/governance/verify-platform-consistency-governance.mjs',
      'tooling/governance/verify-platform-consistency-governance.test.ts',
      'tooling/governance/http-runtime-isolation.test.ts',
      'packages/http/src/dispatch/dispatcher-manual-sse-lifecycle.test.ts',
    ];

    // When
    const enforceChange = () => enforceContractCompanionUpdates(changedFiles);

    // Then
    expect(enforceChange).not.toThrow();
  });

  it('keeps the #3309 connection regression route exempt from manual-SSE evidence', () => {
    // Given
    const changedFiles = [
      'docs/architecture/http-runtime.md',
      'docs/architecture/http-runtime.ko.md',
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
      'tooling/governance/verify-platform-consistency-governance.mjs',
      'tooling/governance/verify-platform-consistency-governance.test.ts',
      'packages/http/src/connection.test.ts',
    ];

    // When
    const enforceChange = () => enforceContractCompanionUpdates(changedFiles);

    // Then
    expect(enforceChange).not.toThrow();
  });
});
