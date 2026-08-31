import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type SourceExcerptGuardReason =
  | 'duplicate-anchor'
  | 'excerpt-drift'
  | 'missing-anchor'
  | 'missing-closing-fence'
  | 'missing-opening-fence';

class SourceExcerptGuardError extends Error {
  constructor(
    readonly reason: SourceExcerptGuardReason,
    readonly citation: string,
  ) {
    super(`Source excerpt guard failed (${reason}): ${citation}`);
    this.name = 'SourceExcerptGuardError';
  }
}

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function sourceRange(source: string, start: number, end: number): string {
  return source.split('\n').slice(start - 1, end).join('\n');
}

function sourceExcerpt(document: string, citation: string): string {
  const lines = document.split('\n');
  const anchor = `\`${citation}\``;
  const citationLineIndexes = lines.flatMap((line, index) => line === anchor ? [index] : []);

  if (citationLineIndexes.length === 0) {
    throw new SourceExcerptGuardError('missing-anchor', citation);
  }

  if (citationLineIndexes.length > 1) {
    throw new SourceExcerptGuardError('duplicate-anchor', citation);
  }

  const citationLineIndex = citationLineIndexes.at(0);

  if (citationLineIndex === undefined) {
    throw new SourceExcerptGuardError('missing-anchor', citation);
  }

  const openingFenceLineIndex = lines.indexOf('```typescript', citationLineIndex + 1);

  if (openingFenceLineIndex < 0) {
    throw new SourceExcerptGuardError('missing-opening-fence', citation);
  }

  const closingFenceLineIndex = lines.indexOf('```', openingFenceLineIndex + 1);

  if (closingFenceLineIndex < 0) {
    throw new SourceExcerptGuardError('missing-closing-fence', citation);
  }

  return lines.slice(openingFenceLineIndex + 1, closingFenceLineIndex).join('\n');
}

function assertSourceExcerpt(document: string, citation: string, expected: string): void {
  if (sourceExcerpt(document, citation) !== expected) {
    throw new SourceExcerptGuardError('excerpt-drift', citation);
  }
}

function expectSourceExcerptGuardFailure(
  action: () => void,
  expectedReason: SourceExcerptGuardReason,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SourceExcerptGuardError);

    if (!(error instanceof SourceExcerptGuardError)) {
      throw error;
    }

    expect(error.reason).toBe(expectedReason);
    return;
  }

  expect.fail(`Expected source excerpt guard failure: ${expectedReason}`);
}

const englishOwnershipClaims = [
  'public `child.dispose()` directly detaches the request child',
  'retained child reference can call `dispose()` again',
  'first reached through parent or root disposal remains parent-tracked after failure',
  'caller that starts the shared attempt sets its direct or parent ownership',
  'later direct retry detaches a parent-retained child after settlement',
] as const;

const koreanOwnershipClaims = [
  'public `child.dispose()`를 직접 호출하면 request child는 active attempt가 settle된 뒤 parent graph에서 분리됩니다',
  '분리된 child 참조를 유지한 caller는 `dispose()`를 다시 호출할 수 있습니다',
  'parent 또는 root disposal이 먼저 진입한 child는 실패 후에도 parent가 계속 추적합니다',
  'shared attempt를 시작한 caller가 direct 또는 parent ownership을 결정합니다',
  'parent가 유지한 child를 나중에 `child.dispose()`로 직접 재시도하면',
] as const;

const ownershipEvidenceTitles = [
  'does not let root disposal retry a directly disposed failed child while root cleanup runs',
  'lets a retained caller retry a detached failed child without replaying successful siblings',
  'keeps direct-first ownership when parent disposal joins the active attempt',
  'keeps parent-first ownership when direct disposal joins the active attempt',
  'detaches a retained child after a later direct retry fails',
] as const;

describe('source excerpt guard', () => {
  const citation = 'path:packages/di/src/container.ts:1-1';
  const expected = 'const value = true;';
  const excerpt = `\`${citation}\`\n\`\`\`typescript\n${expected}\n\`\`\``;

  it('rejects duplicate line-exact citation anchors', () => {
    // Given
    const duplicate = `${excerpt}\n\n${excerpt}`;

    // When / Then
    expectSourceExcerptGuardFailure(
      () => assertSourceExcerpt(duplicate, citation, expected),
      'duplicate-anchor',
    );
  });

  it('rejects a missing line-exact citation anchor', () => {
    // Given
    const missing = excerpt.replace(citation, 'path:packages/di/src/container.ts:2-2');

    // When / Then
    expectSourceExcerptGuardFailure(
      () => assertSourceExcerpt(missing, citation, expected),
      'missing-anchor',
    );
  });

  it('rejects source excerpt drift', () => {
    // Given
    const drifted = excerpt.replace(expected, 'const value = false;');

    // When / Then
    expectSourceExcerptGuardFailure(
      () => assertSourceExcerpt(drifted, citation, expected),
      'excerpt-drift',
    );
  });
});

describe('DI disposal ownership governance', () => {
  it('keeps all five ownership guarantees in the English package and advanced book', () => {
    // Given
    const companions = [read('packages/di/README.md'), read('book/advanced/ch05-scopes.md')];

    // When / Then
    for (const companion of companions) {
      for (const claim of englishOwnershipClaims) {
        expect(companion).toContain(claim);
      }
    }
  });

  it('keeps all five ownership guarantees in the Korean package and advanced book', () => {
    // Given
    const companions = [read('packages/di/README.ko.md'), read('book/advanced/ch05-scopes.ko.md')];

    // When / Then
    for (const companion of companions) {
      for (const claim of koreanOwnershipClaims) {
        expect(companion).toContain(claim);
      }
    }
  });

  it('keeps current origin-aware source excerpts and executable evidence discoverable', () => {
    // Given
    const chapters = [read('book/advanced/ch05-scopes.md'), read('book/advanced/ch05-scopes.ko.md')];
    const packageReadmes = [read('packages/di/README.md'), read('packages/di/README.ko.md')];
    const containerSource = read('packages/di/src/container.ts');
    const ownershipEvidence = read('packages/di/src/container-disposal-ownership.test.ts');
    const retryEvidence = read('packages/di/src/container-disposal-retry.test.ts');
    const sourceExcerpts = [
      ['path:packages/di/src/container.ts:682-703', 682, 703],
      ['path:packages/di/src/container.ts:705-742', 705, 742],
      ['path:packages/di/src/container.ts:1284-1312', 1284, 1312],
      ['path:packages/di/src/container.ts:1422-1578', 1422, 1578],
    ] as const;

    // When / Then
    for (const chapter of chapters) {
      for (const [citation, start, end] of sourceExcerpts) {
        assertSourceExcerpt(chapter, citation, sourceRange(containerSource, start, end));
      }

      expect(chapter).not.toContain('if (completed && this.parent && this.trackedByParent)');
      expect(chapter).not.toContain('Array.from(this.childScopes).map((child) => child.dispose()),');
    }

    for (const companion of [...packageReadmes, ...chapters]) {
      expect(companion).toContain('packages/di/src/container-disposal-ownership.test.ts');
      expect(companion).toContain('packages/di/src/container-disposal-retry.test.ts');
    }

    for (const marker of [
      "type DisposalAttemptOrigin = 'direct' | 'parent';",
      "await this.disposeWithOrigin('direct');",
      'private async disposeFromParent(): Promise<void> {',
      "await this.disposeWithOrigin('parent');",
      'private hasRetainedStaleDisposalTasksInSubtree(): boolean {',
      "if ((origin === 'direct' || (completed && !retainsStaleRetries)) && this.parent && this.trackedByParent) {",
      'const attemptedStaleInstances = new Set<Disposable>();',
      'const disposables = disposalCandidates.filter((instance) => !attemptedStaleInstances.has(instance));',
      'private releaseNonOwnerStaleTaskObserversInSubtree(): void {',
      'this.releaseNonOwnerStaleTaskObserversInSubtree();',
      'childScope.releaseNonOwnerStaleTaskObserversInSubtree();',
      'disposed child owns its remaining retries after that attempt settles',
      'parent-started failed attempt remains owned by the parent hierarchy',
    ]) {
      expect(containerSource).toContain(marker);
    }

    for (const title of ownershipEvidenceTitles) {
      expect(ownershipEvidence).toContain(title);
    }

    expect(retryEvidence).toContain('retries only failed hooks in reverse creation order');
    expect(retryEvidence).toContain('retries nested request scopes before their parent and root');
  });
});
