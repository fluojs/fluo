import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const safetyGuidancePaths = [
  'packages/microservices/README.md',
  'packages/microservices/README.ko.md',
  'book/intermediate/ch01-microservices-intro.md',
  'book/intermediate/ch01-microservices-intro.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
];

const safetyGuidanceAnchors = [
  '1 MiB',
  '`port: 0`',
  '`close()`',
  '`send()`',
  '`emit()`',
  '`AbortSignal`',
  'abort listener',
];

const localizedStreamingCleanupClaims = [
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
];

const runtimeEvidence = [
  [
    'packages/microservices/src/transports/tcp-transport.ts',
    [
      'DEFAULT_MAX_FRAME_BYTES = 1_048_576',
      'this.boundPort = this.resolveBoundPort()',
      "assertAcceptingOutbound(operation: 'emit' | 'send')",
    ],
  ],
  [
    'packages/microservices/src/transports/grpc-transport.ts',
    [
      'const cleanupAbortListeners = () =>',
      'externalAbortCleanup?.()',
      "stream.on('end', () => {",
      "stream.on('error', (err: Error) => {",
      'return(): Promise<IteratorResult<unknown>> {',
      "removeEventListener('abort'",
    ],
  ],
  [
    'packages/microservices/src/transports/tcp-transport.test.ts',
    [
      'closes sockets that exceed the inbound frame buffer cap',
      'routes outbound send and emit through the OS-assigned port when configured with port 0',
      'rejects send and emit after close() stops the listener',
      'keeps the closing guard when listen() races with close()',
    ],
  ],
  [
    'packages/microservices/src/transports/grpc-transport.test.ts',
    [
      'removes unary AbortSignal listener when the response resolves',
      'serverStream() removes AbortSignal listener when the stream ends',
      'serverStream() removes AbortSignal listener when the stream errors',
      'serverStream() removes AbortSignal listener when iterator return() cancels the call',
      'clientStream() removes AbortSignal listener when the response resolves',
      'bidiStream() removes AbortSignal listeners when the reader completes',
    ],
  ],
];

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

export function enforceMicroservicesSafetyGuidanceParity() {
  for (const relativePath of safetyGuidancePaths) {
    const markdown = read(relativePath);

    for (const anchor of safetyGuidanceAnchors) {
      assert(markdown.includes(anchor), `${relativePath} must keep the Microservices safety anchor ${anchor}.`);
    }
  }

  for (const [requiredClaim, relativePaths] of localizedStreamingCleanupClaims) {
    for (const relativePath of relativePaths) {
      assert(
        read(relativePath).includes(requiredClaim),
        `${relativePath} must keep the bounded gRPC streaming cleanup claim ${requiredClaim}.`,
      );
    }
  }
}

export function enforceMicroservicesSafetyRuntimeEvidence() {
  for (const [relativePath, evidenceAnchors] of runtimeEvidence) {
    const source = read(relativePath);

    for (const anchor of evidenceAnchors) {
      assert(source.includes(anchor), `${relativePath} must keep the Microservices safety evidence ${anchor}.`);
    }
  }
}
