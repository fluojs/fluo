import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function section(content: string, startHeading: string, endHeading: string): string {
  const start = content.indexOf(startHeading);
  const end = content.indexOf(endHeading, start + startHeading.length);

  if (start < 0 || end < 0) {
    throw new Error(`Missing governed section from ${startHeading} to ${endHeading}.`);
  }

  return content.slice(start, end);
}

function paragraph(content: string, prefix: string): string {
  const match = content
    .split(/\n\s*\n/u)
    .find((candidate) => candidate.startsWith(prefix));

  if (!match) {
    throw new Error(`Missing governed paragraph starting with ${prefix}.`);
  }

  return match;
}

function sourceExample(content: string, sourceMarker: string): string {
  const sourceStart = content.indexOf(sourceMarker);
  const fence = '```typescript\n';
  const fenceStart = content.indexOf(fence, sourceStart);
  const codeStart = fenceStart + fence.length;
  const codeEnd = content.indexOf('\n```', codeStart);

  if (sourceStart < 0 || fenceStart < 0 || codeEnd < 0) {
    throw new Error(`Missing governed source example for ${sourceMarker}.`);
  }

  return content.slice(codeStart, codeEnd);
}

function expectLifecycleStateAndOperationGate(content: string): void {
  expect(content).toContain('bootstrapped');
  expect(content).toContain('ready');
  expect(content).toContain('closed');
  expect(content).toContain('Application.get()');
  expect(content).toContain('ApplicationContext.get()');
  expect(content).toContain('Application.listen()');
  expect(content).toContain('connectMicroservice()');
  expect(content).toContain('startAllMicroservices()');
}

describe('runtime shutdown terminality documentation', () => {
  it.each([
    'packages/runtime/README.md',
    'packages/runtime/README.ko.md',
    'docs/architecture/lifecycle-and-shutdown.md',
    'docs/architecture/lifecycle-and-shutdown.ko.md',
  ])('preserves lifecycle states while documenting the shutdown operation gate in %s', (relativePath) => {
    expectLifecycleStateAndOperationGate(read(relativePath));
  });

  it.each([
    ['docs/CONTEXT.md', 'Application shutdown terminality is synchronized'],
    ['docs/CONTEXT.ko.md', 'Application shutdown terminality는'],
  ])('keeps the public states and operation gate coupled in the discoverability paragraph for %s', (relativePath, prefix) => {
    expectLifecycleStateAndOperationGate(paragraph(read(relativePath), prefix));
  });

  it.each([
    'book/advanced/ch09-app-context.md',
    'book/advanced/ch09-app-context.ko.md',
  ])('couples terminal operations and retry semantics to executable evidence in %s', (relativePath) => {
    const content = section(
      read(relativePath),
      '## 9.4 Shutdown and failure cleanup are first-class runtime contracts, not afterthoughts',
      '## 9.5 The platform shell and adapter seams define what the runtime may assume about the host',
    );

    expectLifecycleStateAndOperationGate(content);
    expect(content).toContain('keeps failed shutdown terminal while retrying only incomplete cleanup');
    expect(content).toContain(
      'rejects Application.get() as soon as shutdown starts while teardown is pending',
    );
    expect(content).toContain(
      'rejects ApplicationContext.get() as soon as shutdown starts while teardown is pending',
    );
    expect(content).toContain('rejects Application.get() when shutdown starts during provider resolution');
    expect(content).toContain('rejects ApplicationContext.get() when shutdown starts during provider resolution');
    expect(content).toContain('rejects connect and start operations while application close is pending');
    expect(content).toContain('rejects connectMicroservice() when shutdown starts during runtime resolution');
    expect(content).toContain('retries only incomplete application context shutdown phases');
  });

  it.each([
    ['packages/runtime/README.md', 'failed hooks are retried by a later explicit'],
    ['packages/runtime/README.ko.md', '실패한 hook만 이후 명시적'],
    ['docs/architecture/lifecycle-and-shutdown.md', 'retains only failed hooks for a later explicit'],
    ['docs/architecture/lifecycle-and-shutdown.ko.md', '실패한 hook만 이후 명시적'],
    ['docs/CONTEXT.md', 'failed hooks are retried by a later explicit'],
    ['docs/CONTEXT.ko.md', '실패한 hook만 이후 명시적'],
    ['book/advanced/ch09-app-context.md', 'retries those failed hooks on a later explicit'],
    ['book/advanced/ch09-app-context.ko.md', '이후 명시적 application 또는 context close에서 실패한 hook만 재시도합니다'],
  ])('guards terminal best-effort failed-hook retry ownership in %s', (relativePath, retryContract) => {
    const content = read(relativePath);

    expect(content).toContain('onDestroy()');
    expect(content).toContain('terminal best-effort');
    expect(content).toContain(retryContract);
  });

  it.each([
    'book/advanced/ch09-app-context.md',
    'book/advanced/ch09-app-context.ko.md',
  ])('keeps Chapter 9 context get and application listen examples aligned with shutdown admission in %s', (relativePath) => {
    const content = read(relativePath);
    const contextGet = sourceExample(content, 'path:packages/runtime/src/bootstrap.ts:856-896');
    const applicationListen = sourceExample(content, 'path:packages/runtime/src/bootstrap.ts:738-786');

    expect(contextGet).toContain('private closeStarted = false;');
    expect(contextGet.match(/this\.assertProviderResolutionAllowed\(\);/gu)).toHaveLength(2);
    expect(contextGet).not.toContain('return resolveContextToken(');
    expect(applicationListen).toContain('if (this.closeStarted)');
    expect(applicationListen).toContain('this.listenPromise = this.startListening();');
    expect(applicationListen).toContain('Application startup was interrupted by shutdown.');
    expect(applicationListen).not.toContain("if (this.applicationState === 'closed')");
  });

  it('requires the runtime regressions behind the documented terminal and retry concepts', () => {
    const applicationTests = read('packages/runtime/src/application.test.ts');
    const bootstrapTests = read('packages/runtime/src/bootstrap.test.ts');

    expect(applicationTests).toContain('keeps failed shutdown terminal while retrying only incomplete cleanup');
    expect(applicationTests).toContain(
      'rejects Application.get() as soon as shutdown starts while teardown is pending',
    );
    expect(applicationTests).toContain('rejects Application.get() when shutdown starts during provider resolution');
    expect(bootstrapTests).toContain(
      'rejects ApplicationContext.get() as soon as shutdown starts while teardown is pending',
    );
    expect(bootstrapTests).toContain(
      'rejects ApplicationContext.get() when shutdown starts during provider resolution',
    );
    expect(bootstrapTests).toContain('rejects connect and start operations while application close is pending');
    expect(bootstrapTests).toContain(
      'rejects connectMicroservice() when shutdown starts during runtime resolution',
    );
    expect(bootstrapTests).toContain('retries only incomplete application context shutdown phases');
    expect(bootstrapTests).toContain(
      'retries only failed container-managed onDestroy hooks on a second application context close',
    );
  });
});
