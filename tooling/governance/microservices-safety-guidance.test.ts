import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  enforceMicroservicesSafetyGuidanceParity,
  enforceMicroservicesSafetyRuntimeEvidence,
} from './verify-platform-consistency-governance.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('Microservices safety guidance governance', () => {
  it('keeps the four transport safety contracts discoverable in every governed locale and companion', () => {
    expect(() => enforceMicroservicesSafetyGuidanceParity()).not.toThrow();
  });

  it('keeps package source and regression evidence behind the documented safety contracts', () => {
    expect(() => enforceMicroservicesSafetyRuntimeEvidence()).not.toThrow();
  });

  it('requires close-start race plus pre-reader and one-shot gRPC cleanup evidence', () => {
    const governanceSource = readFileSync(
      resolve(repoRoot, 'tooling/governance/microservices-safety-guidance.mjs'),
      'utf8',
    );

    for (const requiredEvidence of [
      'keeps the closing guard when listen() races with close()',
      'serverStream() removes AbortSignal listener when the stream ends before reader iteration starts',
      'serverStream() removes AbortSignal listener when the stream errors before reader iteration starts',
      'serverStream() removes AbortSignal listener when iterator return() runs before the first read',
      'serverStream() removes AbortSignal listener when iterator return() cancels the call',
      'serverStream() removes AbortSignal listener when the stream errors',
      'clientStream() removes AbortSignal listener exactly once when the response errors',
      'bidiStream() removes AbortSignal listeners when the stream ends before reader iteration starts',
      'bidiStream() removes AbortSignal listeners when the stream errors before reader iteration starts',
      'bidiStream() removes AbortSignal listeners exactly once when the reader returns early',
      'bidiStream() does not remove AbortSignal listeners twice when return() follows terminal end',
    ]) {
      expect(governanceSource).toContain(requiredEvidence);
    }
  });

  it('preserves pre-reader terminal and early-return cleanup claims in every locale', () => {
    const localizedClaims = [
      [
        'before reader iteration starts',
        [
          'packages/microservices/README.md',
          'book/intermediate/ch01-microservices-intro.md',
          'docs/CONTEXT.md',
          'docs/reference/package-surface.md',
        ],
      ],
      [
        'reader iteration 시작 전',
        [
          'packages/microservices/README.ko.md',
          'book/intermediate/ch01-microservices-intro.ko.md',
          'docs/CONTEXT.ko.md',
          'docs/reference/package-surface.ko.md',
        ],
      ],
      [
        'returns early',
        [
          'packages/microservices/README.md',
          'book/intermediate/ch01-microservices-intro.md',
          'docs/CONTEXT.md',
          'docs/reference/package-surface.md',
        ],
      ],
      [
        'early return',
        [
          'packages/microservices/README.ko.md',
          'book/intermediate/ch01-microservices-intro.ko.md',
          'docs/CONTEXT.ko.md',
          'docs/reference/package-surface.ko.md',
        ],
      ],
      [
        'only once',
        [
          'packages/microservices/README.md',
          'book/intermediate/ch01-microservices-intro.md',
          'docs/CONTEXT.md',
          'docs/reference/package-surface.md',
        ],
      ],
      [
        '한 번만',
        [
          'packages/microservices/README.ko.md',
          'book/intermediate/ch01-microservices-intro.ko.md',
          'docs/CONTEXT.ko.md',
          'docs/reference/package-surface.ko.md',
        ],
      ],
    ] as const;

    for (const [requiredClaim, relativePaths] of localizedClaims) {
      for (const relativePath of relativePaths) {
        expect(readFileSync(resolve(repoRoot, relativePath), 'utf8')).toContain(requiredClaim);
      }
    }
  });
});
