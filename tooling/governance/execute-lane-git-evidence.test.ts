import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  assertCanonicalCleanupGitState,
  assertCanonicalGitState,
  classifyConflictImpact,
  computeConflictGitEvidence,
} = await import(
  join(process.cwd(), '.agents/skills/execute-lane/scripts/trusted-evidence.mjs'),
);

const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

const commit = (root: string, message: string) => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
};

const setup = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-real-git-evidence-')));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  const origin = join(root, '.origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  git(root, 'config', 'user.email', 'fixture@fluo.dev');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'remote', 'add', 'origin', origin);
  writeFileSync(join(root, '.gitignore'), '.omo/runtime/\n.origin.git/\n');
  writeFileSync(join(root, 'app.txt'), 'old\n');
  const baseHead = commit(root, 'base');
  writeFileSync(join(root, 'app.txt'), 'reviewed feature\n');
  const oldHead = commit(root, 'reviewed');
  git(root, 'checkout', '-q', '-b', 'upstream', baseHead);
  writeFileSync(join(root, 'README.md'), 'upstream\n');
  const upstreamHead = commit(root, 'upstream');
  git(root, 'checkout', '-q', '-b', 'resolved', upstreamHead);
  writeFileSync(join(root, 'app.txt'), 'reviewed feature\n');
  const resolvedHead = commit(root, 'resolved');
  git(root, 'checkout', '-q', 'main');
  const worktreeRelative = '.worktrees/issue-4101-git-evidence';
  const worktree = join(root, worktreeRelative);
  mkdirSync(join(root, '.worktrees'), { recursive: true });
  execFileSync('git', [
    '-C', root, 'worktree', 'add', '-q', '-b', 'issue-4101-git-evidence', worktree, resolvedHead,
  ]);
  git(root, 'push', '-q', '-u', 'origin', 'issue-4101-git-evidence');
  return { root, worktreeRelative, oldHead, upstreamHead, resolvedHead };
};

describe('execute-lane canonical Git evidence', () => {
  it('binds a real registered worktree, exact branch, existing commits, and live HEAD', () => {
    const fixture = setup();
    try {
      mkdirSync(join(fixture.root, fixture.worktreeRelative, '.omo/runtime'), { recursive: true });
      writeFileSync(join(fixture.root, fixture.worktreeRelative, '.omo/runtime/state.json'), '{}\n');
      expect(() => assertCanonicalGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: fixture.resolvedHead,
        commits: [fixture.oldHead, fixture.upstreamHead, fixture.resolvedHead],
      })).not.toThrow();
      expect(() => assertCanonicalGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-wrong',
        expected_head: fixture.resolvedHead,
      })).toThrow(/wrong branch/u);
      expect(() => assertCanonicalGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: fixture.oldHead,
      })).toThrow(/stale|does not match/u);
      expect(() => assertCanonicalGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: 'f'.repeat(40),
      })).toThrow(/trusted command|commit/u);

      writeFileSync(join(fixture.root, fixture.worktreeRelative, 'app.txt'), 'dirty source mutation\n');
      expect(() => assertCanonicalGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: fixture.resolvedHead,
      })).toThrow(/worktree and index must be clean/u);
      git(fixture.root, '-C', join(fixture.root, fixture.worktreeRelative), 'restore', 'app.txt');
      writeFileSync(join(fixture.root, fixture.worktreeRelative, 'generated.txt'), 'untracked generated mutation\n');
      expect(() => assertCanonicalGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: fixture.resolvedHead,
      })).toThrow(/worktree and index must be clean/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails closed while the real origin branch exists even after its remote-tracking ref is pruned', () => {
    const fixture = setup();
    try {
      git(fixture.root, 'worktree', 'remove', '--force', join(fixture.root, fixture.worktreeRelative));
      git(fixture.root, 'branch', '-D', 'issue-4101-git-evidence');
      const cleanup = () => assertCanonicalCleanupGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: fixture.resolvedHead,
      });
      expect(cleanup).toThrow(/live origin issue branch/u);
      git(fixture.root, 'update-ref', '-d', 'refs/remotes/origin/issue-4101-git-evidence');
      expect(cleanup).toThrow(/live origin issue branch/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it('validates a real removed worktree and deleted local and origin branches after cleanup', () => {
    const fixture = setup();
    try {
      git(fixture.root, 'worktree', 'remove', '--force', join(fixture.root, fixture.worktreeRelative));
      git(fixture.root, 'branch', '-D', 'issue-4101-git-evidence');
      git(fixture.root, 'push', '-q', 'origin', '--delete', 'issue-4101-git-evidence');
      expect(() => assertCanonicalCleanupGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: fixture.resolvedHead,
      })).not.toThrow();
      mkdirSync(join(fixture.root, fixture.worktreeRelative), { recursive: true });
      expect(() => assertCanonicalCleanupGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: fixture.resolvedHead,
      })).toThrow(/worktree absent/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    ['runner exception', Object.assign(new Error('runner exploded'), {})],
    ['timeout', Object.assign(new Error('timed out'), { status: null, signal: 'SIGTERM', killed: true, pid: 42 })],
    ['signal', Object.assign(new Error('signalled'), { status: null, signal: 'SIGKILL', killed: false, pid: 42 })],
    ['repository error', Object.assign(new Error('not a repository'), { status: 128, signal: null, killed: false, pid: 42 })],
    ['other exit', Object.assign(new Error('bad usage'), { status: 3, signal: null, killed: false, pid: 42 })],
    ['string exit two', Object.assign(new Error('string status'), { status: '2', signal: null, killed: false, pid: 42 })],
    ['manufactured exit two', Object.assign(new Error('fake missing remote'), { status: 2 })],
  ])('does not treat %s as live origin branch absence', (_label, failure) => {
    const fixture = setup();
    try {
      git(fixture.root, 'worktree', 'remove', '--force', join(fixture.root, fixture.worktreeRelative));
      git(fixture.root, 'branch', '-D', 'issue-4101-git-evidence');
      git(fixture.root, 'push', '-q', 'origin', '--delete', 'issue-4101-git-evidence');
      const runner = (command: string, args: string[], options: Record<string, unknown>) => {
        if (command === 'git' && args.includes('ls-remote')) throw failure;
        return execFileSync(command, args, { ...options, encoding: 'utf8' });
      };
      expect(() => assertCanonicalCleanupGitState({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        branch: 'issue-4101-git-evidence',
        expected_head: fixture.resolvedHead,
        command_runner: runner,
      })).toThrow(/could not prove live origin branch absence/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    ['generic manifest source', 'packages/core/src/manifest.ts'],
    ['generic schema source', 'packages/http/src/schema.ts'],
    ['package-root public source', 'packages/core/src/request.ts'],
    ['core public subpath', 'packages/core/src/core/request-pipeline.ts'],
    ['runtime public subpath', 'packages/platform-nodejs/src/runtime/node.ts'],
    ['websocket public subpath', 'packages/websockets/src/websockets/deno.ts'],
    ['package manifest', 'packages/core/package.json'],
    ['workspace lock', 'pnpm-lock.yaml'],
    ['workflow contract', '.agents/workflow-contracts/review-preflight.schema.json'],
    ['execute-lane authority code', '.agents/skills/execute-lane/scripts/canonical-verification.mjs'],
    ['execute-lane authority test', '.agents/skills/execute-lane/scripts/reviewer-runtime.test.mjs'],
    ['execute-lane authority docs', '.agents/skills/execute-lane/SKILL.md'],
    ['other agent authority', '.agents/README.md'],
    ['GitHub workflow', '.github/workflows/ci.yml'],
    ['release automation', 'tooling/release/publish.mjs'],
    ['permission automation', 'scripts/permissions/check.mjs'],
    ['governance automation', 'tooling/governance/verify-policy.mjs'],
  ])('forces contract, code, and verification for %s', (_name, path) => {
    expect(classifyConflictImpact({ changed_paths: [path], conflicting_paths: [] }))
      .toMatchObject({ minimum_affected_axes: ['contract', 'code', 'verification'] });
  });

  it('forces every axis for unknown contract-like canonical paths', () => {
    expect(classifyConflictImpact({
      changed_paths: ['governance/published-surface.weird'],
      conflicting_paths: [],
    })).toMatchObject({ category: 'unknown', minimum_affected_axes: ['contract', 'code', 'verification'] });
  });

  it('recomputes stable, non-vacuous content and pairwise diff digests from real Git objects', () => {
    const fixture = setup();
    try {
      const first = computeConflictGitEvidence({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        previously_reviewed_head: fixture.oldHead,
        upstream_head: fixture.upstreamHead,
        resolved_head: fixture.resolvedHead,
      });
      const second = computeConflictGitEvidence({
        repository_root: fixture.root,
        worktree: fixture.worktreeRelative,
        previously_reviewed_head: fixture.oldHead,
        upstream_head: fixture.upstreamHead,
        resolved_head: fixture.resolvedHead,
      });
      expect(second.digests).toEqual(first.digests);
      expect(new Set(Object.values(first.digests)).size).toBeGreaterThan(3);
      expect(first.diffs.old_upstream).toContain('README.md');
      expect(first.diffs.upstream_resolved).toContain('app.txt');
      expect(first.patch_equivalent).toBe(true);
      expect(first.upstream_overlap).toBe(false);
      expect(first.mechanical_inheritance_eligible).toBe(true);
      expect(first.patch_digests.reviewed_patch_sha256).toBe(first.patch_digests.resolved_patch_sha256);
      expect({ ...first.digests, old_resolved_diff_sha256: '0'.repeat(64) }).not.toEqual(first.digests);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    ['contract', ['contracts/public.schema.json'], ['contract', 'code', 'verification']],
    ['implementation', ['src/runtime.ts'], ['code', 'verification']],
    ['verification', ['tests/runtime.test.ts'], ['verification']],
    ['contract', ['package.json'], ['contract', 'code', 'verification']],
    ['contract', ['pnpm-lock.yaml'], ['contract', 'code', 'verification']],
    ['contract', ['packages/http/src/index.ts'], ['contract', 'code', 'verification']],
    ['contract', ['.agents/workflow-contracts/event.schema.json'], ['contract', 'code', 'verification']],
    ['cross-cutting', ['src/runtime.ts', 'tests/runtime.test.ts'], ['contract', 'code', 'verification']],
    ['unknown', ['assets/runtime.bin'], ['contract', 'code', 'verification']],
  ])('computes the deterministic %s minimum impact', (category, paths, axes) => {
    expect(classifyConflictImpact({ changed_paths: paths, conflicting_paths: [] })).toEqual({
      category,
      minimum_affected_axes: axes,
      paths,
    });
  });
});
