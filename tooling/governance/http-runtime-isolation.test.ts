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

import { enforceHttpRuntimeCancellationAndContextIsolation } from './verify-platform-consistency-governance.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('HTTP runtime isolation governance', () => {
  it('keeps cancellation, managed SSE backpressure, request context, and fast-path scope isolation enforced', () => {
    // Given
    const verifyContract = () => enforceHttpRuntimeCancellationAndContextIsolation();

    // When / Then
    expect(verifyContract).not.toThrow();
  });

  it('invokes the HTTP runtime content gate from central governance', () => {
    // Given
    const source = createSourceFile(
      'verify-platform-consistency-governance.mjs',
      readFileSync(join(repoRoot, 'tooling/governance/verify-platform-consistency-governance.mjs'), 'utf8'),
      ScriptTarget.Latest,
      true,
      ScriptKind.JS,
    );
    let mainCallsHttpRuntimeContentGate = false;

    // When
    for (const statement of source.statements) {
      if (!isFunctionDeclaration(statement) || statement.name?.text !== 'main' || statement.body === undefined) {
        continue;
      }
      forEachChild(statement.body, function visit(node): void {
        if (isCallExpression(node) && isIdentifier(node.expression)
          && node.expression.text === 'enforceHttpRuntimeCancellationAndContextIsolation') {
          mainCallsHttpRuntimeContentGate = true;
        }
        forEachChild(node, visit);
      });
    }

    // Then
    expect(mainCallsHttpRuntimeContentGate).toBe(true);
  });

  it('keeps byte-range and If-Range evidence wired through executable regressions', () => {
    // Given
    const source = readFileSync(
      join(repoRoot, 'tooling/governance/verify-platform-consistency-governance.mjs'),
      'utf8',
    );

    // When
    const requiredEvidencePaths = [
      'packages/http/src/dispatch/byte-range-response.test.ts',
      'packages/testing/src/portability/http-adapter-portability.ts',
      'packages/testing/src/portability/http-adapter-portability.test.ts',
    ];

    // Then
    for (const evidencePath of requiredEvidencePaths) {
      expect(source).toContain(evidencePath);
    }
    expect(source).toContain("if-range");
    expect(source).toContain('assertSupportsSingleByteRanges');
  });
});
