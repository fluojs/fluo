import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The package closure must be built first. Resolve the real export map rather than source aliases.
const fixture = fileURLToPath(new URL(
  `../../packages/event-bus/examples/result-contract-${randomUUID()}.mts`,
  import.meta.url,
));
const imports = [
  "import { EVENT_BUS, EventBusLifecycleService } from '@fluojs/event-bus';",
  "import type { EventBus, EventBusWithResults, EventDeliveryOutcome, EventDeliveryStatus, EventPublishResult, EventPublishSettlement } from '@fluojs/event-bus';",
  "import type { Container } from '@fluojs/di';",
].join('\n');

function compile(source: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    strict: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ESNext,
    types: ['node'],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fixture
      ? ts.createSourceFile(path, source, languageVersion, true)
      : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host));
}

describe('event-bus emitted result declarations', () => {
  it('preserves legacy implementations and exposes typed service and token results', () => {
    // Given
    const consumer = `${imports}
declare const container: Container;
declare const service: EventBusLifecycleService;
const legacy: EventBus = { async publish() {} };
const legacyToken: Promise<EventBus> = container.resolve<EventBus>(EVENT_BUS);
const facade: Promise<EventBusWithResults> = container.resolve(EVENT_BUS);
const result: EventPublishResult = await service.publishWithResult({});
if (result.status === 'background') {
  const completion: Promise<EventPublishSettlement> = result.completion;
} else if (result.status === 'settled') {
  const outcomes: readonly EventDeliveryOutcome[] = result.outcomes;
  for (const outcome of outcomes) {
    if (outcome.status === 'timed-out') {
      const timeout: number = outcome.timeoutMs;
    } else if (outcome.status === 'cancelled') {
      const started: boolean = outcome.started;
    }
  }
} else if (result.status === 'rejected') {
  const lifecycle: 'failed' | 'stopping' | 'stopped' = result.reason;
} else {
  const empty: readonly [] = result.outcomes;
}
`;

    // When
    const diagnostics = compile(consumer);

    // Then
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  });

  it('rejects un-narrowed results, incomplete statuses and payload/error access', () => {
    // Given
    const setup = `${imports}
declare const legacy: EventBus;
declare const result: EventPublishResult;
declare const outcome: EventDeliveryOutcome;`;
    const invalid = [
      'legacy.publishWithResult({});',
      "const timeout: EventDeliveryStatus = { status: 'timed-out' };",
      "const background: EventPublishResult = { status: 'background', outcomes: [] };",
      'result.outcomes;',
      'outcome.payload;',
      'outcome.error;',
    ];

    // When
    const diagnostics = compile(`${setup}\n${invalid.join('\n')}`);

    // Then: dependency/import failures cannot count as the intended invalid-consumer failures.
    expect(diagnostics.filter((diagnostic) =>
      diagnostic.file?.fileName !== fixture || diagnostic.start === undefined || diagnostic.code === 2307,
    )).toEqual([]);
    const lines = new Set(diagnostics.flatMap((diagnostic) =>
      diagnostic.file && diagnostic.start !== undefined
        ? [diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line]
        : [],
    ));
    expect([...lines].sort((a, b) => a - b)).toEqual(
      invalid.map((_, index) => setup.split('\n').length + index),
    );
  });
});
