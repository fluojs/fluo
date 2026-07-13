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
];

const grpcStreamingWriterGuidance = [
  [
    'book/intermediate/ch08-grpc.md',
    [
      'writer: ServerStreamWriter,',
      'Regression coverage proves server-streaming `end()` completion, `ServerStreamWriter.error()` propagation, and server-stream outbound cancellation.',
      'Separate tests cover `AbortSignal` listener cleanup in server-, client-, and bidirectional streaming calls.',
      '`ServerStreamWriter.write()` returns `void`',
      'does not expose a backpressure or drain contract',
    ],
  ],
  [
    'book/intermediate/ch08-grpc.ko.md',
    [
      'writer: ServerStreamWriter,',
      '회귀 테스트는 서버 스트리밍의 `end()` 완료, `ServerStreamWriter.error()` 전파, 서버 스트림 outbound 취소를 검증합니다.',
      '별도 테스트는 서버, 클라이언트, 양방향 스트리밍 호출의 `AbortSignal` listener cleanup을 검증합니다.',
      '`ServerStreamWriter.write()`는 `void`를 반환',
      'backpressure 또는 drain 계약을 노출하지 않습니다',
    ],
  ],
];

const overclaimedGrpcStreamingGuidance = [
  [
    'book/intermediate/ch08-grpc.md',
    'Regression coverage proves `end()` completion, `error()` propagation, outbound cancellation, and `AbortSignal` listener cleanup across the three streaming modes.',
  ],
  [
    'book/intermediate/ch08-grpc.ko.md',
    '회귀 테스트는 세 스트리밍 모드에서 `end()` 완료, `error()` 전파, outbound 취소, `AbortSignal` listener cleanup을 검증합니다.',
  ],
];

const runtimeEvidence = [
  [
    'packages/microservices/src/types.ts',
    [
      'export interface ServerStreamWriter',
      'write(data: unknown): void;',
      'end(): void;',
      'error(err: Error): void;',
    ],
  ],
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
      'cleanupExternalAbortListener = undefined',
      'if (done) {',
      'return grpcReadableToAsyncIterable(stream, {',
      "stream.on('end', () => {",
      "stream.on('error', (err: Error) => {",
      'return(): Promise<IteratorResult<unknown>> {',
      "removeEventListener('abort'",
      'const writer: ServerStreamWriter = {',
      'write(data: unknown): void {',
      'call.write(data);',
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
      'serverStream() removes AbortSignal listener when the stream ends before reader iteration starts',
      'serverStream() removes AbortSignal listener when the stream errors before reader iteration starts',
      'serverStream() removes AbortSignal listener when iterator return() runs before the first read',
      'serverStream() removes AbortSignal listener when iterator return() cancels the call',
      'clientStream() removes AbortSignal listener when the response resolves',
      'clientStream() removes AbortSignal listener exactly once when the response errors',
      'bidiStream() removes AbortSignal listeners when the reader completes',
      'bidiStream() removes AbortSignal listeners when the stream ends before reader iteration starts',
      'bidiStream() removes AbortSignal listeners when the stream errors before reader iteration starts',
      'bidiStream() removes AbortSignal listeners exactly once when the reader returns early',
      'bidiStream() does not remove AbortSignal listeners twice when return() follows terminal end',
      'server-streaming handler end signals completion to async iterator',
      'server-stream writer.error() surfaces as an error on the client iterator',
      'serverStream() supports abort via AbortSignal',
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

  for (const [relativePath, requiredClaims] of grpcStreamingWriterGuidance) {
    const markdown = read(relativePath);

    assert(
      !markdown.includes('ServerStreamWriter<'),
      `${relativePath} must use the public non-generic ServerStreamWriter contract.`,
    );

    for (const requiredClaim of requiredClaims) {
      assert(
        markdown.includes(requiredClaim),
        `${relativePath} must keep the source-backed gRPC streaming writer guidance ${requiredClaim}.`,
      );
    }
  }

  for (const [relativePath, overclaimedGuidance] of overclaimedGrpcStreamingGuidance) {
    assert(
      !read(relativePath).includes(overclaimedGuidance),
      `${relativePath} must not overclaim cross-mode gRPC streaming error propagation.`,
    );
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
