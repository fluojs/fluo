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

  it('requires close-start race plus gRPC error and early-return cleanup evidence', () => {
    const governanceSource = readFileSync(
      resolve(repoRoot, 'tooling/governance/microservices-safety-guidance.mjs'),
      'utf8',
    );

    for (const requiredEvidence of [
      'keeps the closing guard when listen() races with close()',
      'serverStream() removes AbortSignal listener when iterator return() cancels the call',
      'serverStream() removes AbortSignal listener when the stream errors',
    ]) {
      expect(governanceSource).toContain(requiredEvidence);
    }
  });

  it('limits streaming cleanup claims to terminal events after reader consumption starts', () => {
    const localizedClaims = [
      [
        'reader has started',
        [
          'packages/microservices/README.md',
          'book/intermediate/ch01-microservices-intro.md',
          'docs/CONTEXT.md',
          'docs/reference/package-surface.md',
        ],
      ],
      [
        'reader가 시작된 뒤',
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
