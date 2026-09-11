import { execFile } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveWorkspaceBuildOrder } from '../scripts/run-workspace-build-closure.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
let root: string;
let fixture: string;
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
  afterAll(async () => {
    if (root) await rm(root, { force: true, recursive: true });
  });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fluo-event-bus-declarations-'));
    // Match the copied build CLI argv path to Node's canonical import.meta URL.
    root = await realpath(root);
    fixture = join(root, 'packages/event-bus/examples/result-contract.mts');
    const packages = resolveWorkspaceBuildOrder('@fluojs/event-bus', repositoryRoot);
    const buildClosureScript = 'tooling/scripts/run-workspace-build-closure.mjs';
    for (const entry of [
      'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json',
      'tooling/babel', 'tooling/tsconfig', 'tooling/vite',
      'tooling/scripts/clean-dist.mjs', buildClosureScript,
      'packages/vite',
      ...packages.map((name) => `packages/${name.slice('@fluojs/'.length)}`),
    ]) {
      await cp(join(repositoryRoot, entry), join(root, entry), {
        recursive: true,
        // Relative workspace links must resolve inside the copied closure.
        verbatimSymlinks: true,
        filter: (source) => !['dist', '.vite', '.vite-temp'].includes(basename(source)),
      });
    }
    // Share external tools only; each package's workspace links were copied above.
    await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    // Always build cold declarations, then let NodeNext resolve the real export maps.
    await execFileAsync(process.execPath, [join(root, buildClosureScript), '@fluojs/event-bus'], {
      cwd: root,
      env: process.env,
      timeout: 240_000,
    });
  }, 300_000);

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
