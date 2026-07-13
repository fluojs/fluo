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

  it('keeps the gRPC streaming writer example aligned with the non-generic public contract', () => {
    // Given
    const writerContract = readFileSync(
      resolve(repoRoot, 'packages/microservices/src/types.ts'),
      'utf8',
    );
    const chapters = [
      readFileSync(resolve(repoRoot, 'book/intermediate/ch08-grpc.md'), 'utf8'),
      readFileSync(resolve(repoRoot, 'book/intermediate/ch08-grpc.ko.md'), 'utf8'),
    ];

    // When / Then
    expect(writerContract).toContain('export interface ServerStreamWriter');
    expect(writerContract).toContain('write(data: unknown): void;');

    for (const chapter of chapters) {
      expect(chapter).toContain('writer: ServerStreamWriter,');
      expect(chapter).not.toContain('ServerStreamWriter<');
    }
  });

  it('limits gRPC streaming guidance to source-backed completion, errors, and cancellation', () => {
    // Given
    const englishChapter = readFileSync(resolve(repoRoot, 'book/intermediate/ch08-grpc.md'), 'utf8');
    const koreanChapter = readFileSync(resolve(repoRoot, 'book/intermediate/ch08-grpc.ko.md'), 'utf8');
    const transportSource = readFileSync(
      resolve(repoRoot, 'packages/microservices/src/transports/grpc-transport.ts'),
      'utf8',
    );
    const transportTests = readFileSync(
      resolve(repoRoot, 'packages/microservices/src/transports/grpc-transport.test.ts'),
      'utf8',
    );

    // When / Then
    expect(transportSource).toContain('write(data: unknown): void {');
    expect(transportSource).toContain('call.write(data);');
    expect(transportTests).toContain('server-streaming handler end signals completion to async iterator');
    expect(transportTests).toContain('server-stream writer.error() surfaces as an error on the client iterator');
    expect(transportTests).toContain('serverStream() supports abort via AbortSignal');
    expect(englishChapter).toContain('does not expose a backpressure or drain contract');
    expect(koreanChapter).toContain('backpressure 또는 drain 계약을 노출하지 않습니다');
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
