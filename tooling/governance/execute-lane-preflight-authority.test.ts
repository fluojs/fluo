import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const { writeActualShapedImplementerTask } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/implementer-task.mjs',
  )
);
const { prepareCanonicalV2Runtime } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/v2-canonical-runtime.mjs',
  )
);
const { parseAcceptanceCriteria } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/trusted-evidence.mjs',
  )
);
const { createReviewPreflight } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/review-loop-policy.mjs',
  )
);
const {
  applyIssueSupervisorTransition: applyIssueSupervisorTransitionRaw,
  initialiseIssueSupervisorStore: initialiseIssueSupervisorStoreRaw,
  loadIssueSupervisorStore: loadIssueSupervisorStoreRaw,
} = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-supervisor-store.mjs',
  )
);

const runners = new Map<string, any>();
const initialiseIssueSupervisorStore = (
  runtimeRoot: string,
  identity: unknown,
  options: Readonly<Record<string, unknown>> = {},
) =>
  initialiseIssueSupervisorStoreRaw(runtimeRoot, identity, {
    command_runner: runners.get(runtimeRoot),
    ...options,
  });
const applyIssueSupervisorTransition = (
  runtimeRoot: string,
  lane: string,
  issue: number,
  transition: unknown,
) => applyIssueSupervisorTransitionRaw(runtimeRoot, lane, issue, transition, {
  command_runner: runners.get(runtimeRoot),
});
const loadIssueSupervisorStore = (runtimeRoot: string, lane: string, issue: number) =>
  loadIssueSupervisorStoreRaw(runtimeRoot, lane, issue, { command_runner: runners.get(runtimeRoot) });

const laneId = 'lane-4101-authority';
const issueNumber = 4101;
const identityFor = (repositoryRoot: string) => ({
  lane_id: laneId,
  issue_number: issueNumber,
  branch: 'issue-4101-authority',
  worktree: '.worktrees/issue-4101-authority',
  starting_head_sha: 'a'.repeat(40),
  started_at: '2026-08-26T00:00:00.000Z',
  review_policy: 'preflight-v1',
  repository_root: repositoryRoot,
  parent_session_id: 'ses_authority_parent',
});

const setup = (releaseHandoff = false) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-authority-')));
  const fixture = prepareCanonicalV2Runtime({
    repository_root: root,
    lane_id: laneId,
    issue_numbers: [issueNumber],
    release_handoffs: releaseHandoff ? [issueNumber] : [],
  });
  runners.set(fixture.runtimeRoot, fixture.commandRunner);
  return { root, ...fixture };
};

const realGitSetup = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-authority-real-git-')));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'fixture@fluo.dev']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Fixture']);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/fluojs/fluo.git']);
  writeFileSync(resolve(root, 'base.txt'), 'base\n');
  execFileSync('git', ['-C', root, 'add', 'base.txt']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'base']);
  const startingHead = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  mkdirSync(resolve(root, '.worktrees'));
  execFileSync('git', ['-C', root, 'worktree', 'add', '-q', '-b', 'issue-4101-authority', resolve(root, '.worktrees/issue-4101-authority'), startingHead]);
  const fixture = prepareCanonicalV2Runtime({ repository_root: root, lane_id: laneId, issue_numbers: [issueNumber] });
  const runner = (command: string, args: string[], options: Record<string, unknown>) =>
    command === 'git'
      ? execFileSync(command, args, { ...options, encoding: 'utf8' })
      : fixture.commandRunner(command, args, options);
  runners.set(fixture.runtimeRoot, runner);
  return { root, startingHead, ...fixture };
};

const preflightFor = (snapshot: Record<string, any>) =>
  createReviewPreflight({
    lane_id: laneId,
    issue_number: issueNumber,
    issue_contract_revision: snapshot.issue_contract_revision,
    issue_contract_sha256: snapshot.issue_contract_sha256,
    lane_plan_approval_sha256: snapshot.lane_plan_approval_sha256,
    head_sha: snapshot.starting_head_sha,
    generated_at: '2026-08-26T00:00:00.000Z',
    approved_sources: snapshot.preflight_authority.canonical_sources,
    acceptance_row_ids: snapshot.preflight_authority.canonical_acceptance_ids,
    rows: snapshot.preflight_authority.canonical_acceptance_ids.map((id: string, index: number) => ({
        id,
        acceptance_text: snapshot.preflight_authority.canonical_acceptance_criteria[index].content,
        acceptance_sha256: snapshot.preflight_authority.canonical_acceptance_criteria[index].content_sha256,
        source: snapshot.preflight_authority.canonical_sources.at(-1).source,
        source_bindings: snapshot.preflight_authority.canonical_sources,
        invariant: 'Canonical issue acceptance remains authoritative.',
        surfaces: ['issue-supervisor'],
        positive_cases: ['The canonical acceptance is implemented.'],
        negative_cases: ['A substituted source is rejected.'],
        boundary_cases: ['Every canonical identifier remains present.'],
      })),
    nonfunctional: {
      complexity: 'Authority validation is bounded by canonical artifacts.',
      memory: 'Only digest-bound authority is persisted.',
      atomicity: 'Authority and preflight transition atomically.',
      mutation_boundary: 'Only the canonical issue store is written.',
    },
  });

describe('execute-lane canonical preflight authority', () => {
  it('derives and persists complete authority from canonical repository artifacts', () => {
    const fixture = setup();
    try {
      expect(fixture.ledger).not.toHaveProperty(
        'lane_plan_approval_sha256',
      );
      const bundle = initialiseIssueSupervisorStore(
        fixture.runtimeRoot,
        identityFor(fixture.root),
      );
      expect(bundle.snapshot.preflight_authority).toMatchObject({
        lane_id: laneId,
        issue_number: issueNumber,
        issue_authority_gate: 'confirmed-issues',
      });
      expect(bundle.snapshot.preflight_authority.canonical_acceptance_ids[0]).toMatch(
        new RegExp(`^issue:${String(issueNumber)}:acceptance:1:`),
      );
      expect(bundle.snapshot.issue_contract_sha256).not.toBe('1'.repeat(64));
      expect(bundle.snapshot.lane_plan_approval_sha256).toBe(
        fixture.approval.binding_sha256,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('accepts an explicitly approved suggested addition and rejects an unapproved one', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-authority-addition-')));
    const fixture = prepareCanonicalV2Runtime({
      repository_root: root,
      lane_id: laneId,
      issue_numbers: [4100, issueNumber],
      selected_issue_numbers: [4100],
    });
    runners.set(fixture.runtimeRoot, fixture.commandRunner);
    try {
      const approved = initialiseIssueSupervisorStore(fixture.runtimeRoot, identityFor(root));
      expect(approved.snapshot.preflight_authority.issue_authority_gate).toBe('suggested-additions');
      const suggestedPath = resolve(root, `.omo/approvals/approval-${laneId}-suggested-additions.json`);
      const suggested = JSON.parse(readFileSync(suggestedPath, 'utf8')) as Record<string, any>;
      suggested.issue_numbers = [];
      writeFileSync(suggestedPath, JSON.stringify(suggested));
      expect(() => loadIssueSupervisorStore(fixture.runtimeRoot, laneId, issueNumber)).toThrow(
        /suggested-additions.*does not authorize/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires an explicit Acceptance Criteria section and ignores unrelated issue bullets', () => {
    const fixture = setup();
    try {
      fixture.commandRunner.setIssue(issueNumber, {
        body: '## Implementation notes\n- This unrelated bullet is not acceptance.\n- Nor is this one.',
      });
      expect(() => initialiseIssueSupervisorStore(
        fixture.runtimeRoot,
        identityFor(fixture.root),
      )).toThrow(/Acceptance Criteria section/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('finds only a real fence-aware Acceptance Criteria heading and preserves every exact block', () => {
    const markdown = [
      '```md',
      '## Acceptance Criteria',
      '- fake fenced criterion',
      '```',
      '# Context',
      'text',
      '## Acceptance Criteria',
      '- [ ] First criterion  ',
      '  continuation paragraph',
      '',
      '  - nested bullet',
      '    ### indented heading remains criterion content',
      '  ~~~~ts',
      '  ## fenced heading remains criterion content',
      '  ~~~~',
      '- [x] Second criterion',
      '  1. nested ordered item',
      '  final paragraph',
      '### Real next section',
      '- unrelated',
    ].join('\r\n');
    expect(parseAcceptanceCriteria(markdown)).toEqual([
      '- [ ] First criterion  \n  continuation paragraph\n\n  - nested bullet\n    ### indented heading remains criterion content\n  ~~~~ts\n  ## fenced heading remains criterion content\n  ~~~~',
      '- [x] Second criterion\n  1. nested ordered item\n  final paragraph',
    ]);
  });

  it.each([0, 1, 2, 3])('recognizes CommonMark headings with %i leading spaces outside fences', (spaces) => {
    const indent = ' '.repeat(spaces);
    expect(parseAcceptanceCriteria([
      `${indent}## Acceptance Criteria`,
      '- [ ] Exact criterion',
      `${indent}## Next section`,
      '- unrelated',
    ].join('\n'))).toEqual(['- [ ] Exact criterion']);
  });

  it('keeps four-space headings as criterion content', () => {
    expect(parseAcceptanceCriteria([
      '## Acceptance Criteria',
      '- [ ] Exact criterion',
      '    ## indented code heading',
      '    body',
      '## Next section',
    ].join('\n'))).toEqual([
      '- [ ] Exact criterion\n    ## indented code heading\n    body',
    ]);
  });

  it('preserves full multiline acceptance blocks and keeps nested bullets with their parent', () => {
    const fixture = setup();
    try {
      fixture.commandRunner.setIssue(issueNumber, {
        body: [
          '## Context',
          '- unrelated bullet',
          '',
          '## Acceptance Criteria',
          '- [ ] First criterion line  ',
          '  continuation paragraph',
          '',
          '  - nested requirement',
          '    - deeply nested detail',
          '',
          '  ```ts',
          '  const exact = true;',
          '  ```',
          '- [ ] Second criterion',
          '',
          '  second paragraph',
          '',
          '## Notes',
          '- unrelated trailing bullet',
        ].join('\r\n'),
      });
      const bundle = initialiseIssueSupervisorStore(fixture.runtimeRoot, identityFor(fixture.root));
      const criteria = bundle.snapshot.preflight_authority.canonical_acceptance_criteria;
      expect(criteria.map(({ content }: { content: string }) => content)).toEqual([
        '- [ ] First criterion line  \n  continuation paragraph\n\n  - nested requirement\n    - deeply nested detail\n\n  ```ts\n  const exact = true;\n  ```',
        '- [ ] Second criterion\n\n  second paragraph',
      ]);
      expect(criteria).toHaveLength(2);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects self-consistent acceptance text or digest substitution', () => {
    const fixture = setup();
    try {
      const bundle = initialiseIssueSupervisorStore(fixture.runtimeRoot, identityFor(fixture.root));
      const valid = preflightFor(bundle.snapshot);
      const substitutedText = 'A trivial substitute criterion.';
      const substituted = createReviewPreflight({
        ...valid,
        rows: [{
          ...valid.rows[0],
          acceptance_text: substitutedText,
          acceptance_sha256: createHash('sha256').update(JSON.stringify({ content: substitutedText })).digest('hex'),
        }],
      });
      expect(() => applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        laneId,
        issueNumber,
        { kind: 'preflight-completed', preflight: substituted },
      )).toThrow(/acceptance text and digest|bind the issue contract/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects caller-selected, fake self-consistent, and symlink roots', () => {
    const canonical = setup();
    const fake = setup();
    const linkParent = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-authority-link-')));
    const rootLink = join(linkParent, 'repository-link');
    symlinkSync(canonical.root, rootLink);
    try {
      expect(() =>
        initialiseIssueSupervisorStore(fake.runtimeRoot, identityFor(canonical.root)),
      ).toThrow(/runtime root/u);
      expect(() =>
        initialiseIssueSupervisorStore(canonical.runtimeRoot, identityFor(fake.root)),
      ).toThrow(/runtime root/u);
      expect(() =>
        initialiseIssueSupervisorStore(canonical.runtimeRoot, identityFor(rootLink)),
      ).toThrow(/real directory|runtime root/u);
    } finally {
      rmSync(canonical.root, { recursive: true, force: true });
      rmSync(fake.root, { recursive: true, force: true });
      rmSync(linkParent, { recursive: true, force: true });
    }
  });

  it('binds the issue store to the observed supervisor session', () => {
    const fixture = setup();
    try {
      expect(() =>
        initialiseIssueSupervisorStore(
          fixture.runtimeRoot,
          {
            ...identityFor(fixture.root),
            parent_session_id: 'ses-forged-supervisor',
          },
          {
            command_runner: fixture.commandRunner,
            supervisor_session_id: 'ses-observed-supervisor',
          },
        ),
      ).toThrow(/parent session does not match/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects substituted approval/source artifacts and omitted acceptance identifiers', () => {
    const fixture = setup();
    try {
      const initial = initialiseIssueSupervisorStore(
        fixture.runtimeRoot,
        identityFor(fixture.root),
      );
      const valid = preflightFor(initial.snapshot);
      expect(() =>
        applyIssueSupervisorTransition(
          fixture.runtimeRoot,
          laneId,
          issueNumber,
          {
            kind: 'preflight-completed',
            preflight: createReviewPreflight({
              ...valid,
              approved_sources: valid.approved_sources.slice(0, 2),
              rows: [
                {
                  ...valid.rows[0],
                  source: valid.approved_sources[0].source,
                  source_bindings: valid.approved_sources.slice(0, 2),
                },
              ],
            }),
          },
        ),
      ).toThrow(/issue contract|canonical.*source/u);

      const sourcePath = resolve(fixture.root, fixture.ledger.source.search_ledger);
      const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
      source.artifact_id = 'search:substituted';
      writeFileSync(sourcePath, JSON.stringify(source));
      expect(() =>
        applyIssueSupervisorTransition(
          fixture.runtimeRoot,
          laneId,
          issueNumber,
          { kind: 'preflight-completed', preflight: valid },
        ),
      ).toThrow(/search-artifact-v2|source artifact/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects stale live issue revisions and accepts a canonical digest-bound docs source', () => {
    const fixture = setup();
    try {
      let bundle = initialiseIssueSupervisorStore(fixture.runtimeRoot, identityFor(fixture.root));
      const docsPath = resolve(fixture.root, 'docs', 'authority.md');
      mkdirSync(resolve(docsPath, '..'), { recursive: true });
      const content = '# Canonical authority\n';
      writeFileSync(docsPath, content);
      const docsSource = {
        source: 'docs/authority.md',
        revision: 'd'.repeat(40),
        content_sha256: createHash('sha256').update(content).digest('hex'),
      };
      const matrix = preflightFor(bundle.snapshot);
      matrix.approved_sources.push(docsSource);
      matrix.rows[0].source_bindings.push(docsSource);
      const withDocs = createReviewPreflight({ ...matrix, sha256: undefined });
      bundle = applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        laneId,
        issueNumber,
        { kind: 'preflight-completed', preflight: withDocs },
      );
      expect(bundle.snapshot.review_preflight.approved_sources).toContainEqual(docsSource);

      fixture.commandRunner.setIssue(issueNumber, { updatedAt: '2026-08-27T00:00:00Z' });
      expect(() => loadIssueSupervisorStore(fixture.runtimeRoot, laneId, issueNumber)).toThrow(
        /stale|does not match GitHub/u,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects nonexistent Git heads, wrong branches, and missing worktrees', () => {
    for (const failure of ['head', 'branch', 'worktree'] as const) {
      const fixture = setup();
      try {
        const identity = identityFor(fixture.root);
        if (failure === 'worktree') {
          rmSync(resolve(fixture.root, identity.worktree), { recursive: true, force: true });
        } else {
          const base = fixture.commandRunner;
          const runner: any = (command: string, args: string[], options: unknown) => {
            if (failure === 'head' && command === 'git' && args.includes('cat-file')) {
              throw new TypeError('missing commit');
            }
            if (failure === 'branch' && command === 'git' && args.includes('symbolic-ref')) {
              return 'issue-9999-wrong\n';
            }
            return base(command, args, options);
          };
          runner.setIssue = base.setIssue;
          runners.set(fixture.runtimeRoot, runner);
        }
        expect(() => initialiseIssueSupervisorStore(fixture.runtimeRoot, identity)).toThrow(
          /worktree|branch|commit|trusted command/u,
        );
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  });

  it('persists canonical release handoff only after accepted preflight', () => {
    const fixture = setup(true);
    try {
      let bundle = initialiseIssueSupervisorStore(
        fixture.runtimeRoot,
        identityFor(fixture.root),
      );
      expect(bundle.snapshot).toMatchObject({
        version: 2,
        status: 'preflight',
        release_handoff: true,
      });
      expect(() =>
        applyIssueSupervisorTransition(
          fixture.runtimeRoot,
          laneId,
          issueNumber,
          {
            kind: 'release-handoff',
            approval_sha256: bundle.snapshot.lane_plan_approval_sha256,
          },
        ),
      ).toThrow(/preflight|implementing/u);

      bundle = applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        laneId,
        issueNumber,
        { kind: 'preflight-completed', preflight: preflightFor(bundle.snapshot) },
      );
      expect(() =>
        applyIssueSupervisorTransition(
          fixture.runtimeRoot,
          laneId,
          issueNumber,
          { kind: 'release-handoff', approval_sha256: 'f'.repeat(64) },
        ),
      ).toThrow(/approval/u);
      bundle = applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        laneId,
        issueNumber,
        {
          kind: 'release-handoff',
          approval_sha256: bundle.snapshot.lane_plan_approval_sha256,
        },
      );
      expect(bundle.snapshot).toMatchObject({
        version: 2,
        status: 'blocked-maintainer-decision',
      });
      expect(bundle.snapshot.review_preflight).not.toBeNull();
      expect(bundle.events.map((event: Record<string, unknown>) => [event.version, event.kind])).toEqual([
        [2, 'initialised'],
        [2, 'preflight-completed'],
        [2, 'release-handoff'],
      ]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('accepts a real Git implementer commit before the head-advancing transition', () => {
    const fixture = realGitSetup();
    try {
      let bundle = initialiseIssueSupervisorStore(fixture.runtimeRoot, {
        ...identityFor(fixture.root), starting_head_sha: fixture.startingHead,
      });
      bundle = applyIssueSupervisorTransition(fixture.runtimeRoot, laneId, issueNumber, {
        kind: 'preflight-completed', preflight: preflightFor(bundle.snapshot),
      });
      const worktree = resolve(fixture.root, bundle.snapshot.worktree);
      writeFileSync(resolve(worktree, 'implemented.txt'), 'implemented\n');
      execFileSync('git', ['-C', worktree, 'add', 'implemented.txt']);
      execFileSync('git', ['-C', worktree, 'commit', '-q', '-m', 'implementation']);
      const newHead = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      writeActualShapedImplementerTask({
        repository_root: fixture.root, task_id: 'st_real_git_advance',
        parent_session_id: bundle.snapshot.parent_session_id, lane_id: laneId,
        issue_number: issueNumber, worktree: bundle.snapshot.worktree,
        current_head: fixture.startingHead, new_head: newHead, generation: 1,
        result: 'implementation-completed', verification: 'focused tests passed',
        preflight_sha256: bundle.snapshot.review_preflight.sha256,
      });
      bundle = applyIssueSupervisorTransition(fixture.runtimeRoot, laneId, issueNumber, {
        kind: 'implementation-completed', new_head: newHead,
        verification: 'focused tests passed', implementer_generation: 1,
        implementer_evidence: { task_id: 'st_real_git_advance' },
      });
      expect(bundle.snapshot.head_sha).toBe(newHead);
      expect(bundle.snapshot.status).toBe('local-review');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('terminalizes malformed child provenance after an unaccepted worktree head', () => {
    const fixture = realGitSetup();
    try {
      let bundle = initialiseIssueSupervisorStore(fixture.runtimeRoot, {
        ...identityFor(fixture.root),
        starting_head_sha: fixture.startingHead,
      });
      bundle = applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        laneId,
        issueNumber,
        {
          kind: 'preflight-completed',
          preflight: preflightFor(bundle.snapshot),
        },
      );
      const worktree = resolve(fixture.root, bundle.snapshot.worktree);
      writeFileSync(resolve(worktree, 'unaccepted.txt'), 'unaccepted\n');
      execFileSync('git', ['-C', worktree, 'add', 'unaccepted.txt']);
      execFileSync(
        'git',
        ['-C', worktree, 'commit', '-q', '-m', 'unaccepted child output'],
      );
      const observedHead = execFileSync(
        'git',
        ['-C', worktree, 'rev-parse', 'HEAD'],
        { encoding: 'utf8' },
      ).trim();

      bundle = applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        laneId,
        issueNumber,
        {
          kind: 'child-contract-error',
          observed_head: observedHead,
          signature: 'implementer-spawn-provenance-invalid',
          evidence:
            'The completed child contained conflicting dispatch authority.',
        },
      );

      expect(bundle.snapshot.status).toBe('blocked-child-contract-error');
      expect(bundle.snapshot.head_sha).toBe(observedHead);
      expect(
        loadIssueSupervisorStore(
          fixture.runtimeRoot,
          laneId,
          issueNumber,
        ).snapshot.status,
      ).toBe('blocked-child-contract-error');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects persisted implementer task/output receipt tampering', () => {
    const fixture = setup();
    try {
      let bundle = initialiseIssueSupervisorStore(
        fixture.runtimeRoot,
        identityFor(fixture.root),
      );
      bundle = applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        laneId,
        issueNumber,
        { kind: 'preflight-completed', preflight: preflightFor(bundle.snapshot) },
      );
      const taskId = 'st_authorityfirst';
      const newHead = 'b'.repeat(40);
      writeActualShapedImplementerTask({
        repository_root: fixture.root,
        task_id: taskId,
        parent_session_id: bundle.snapshot.parent_session_id,
        lane_id: laneId,
        issue_number: issueNumber,
        worktree: bundle.snapshot.worktree,
        current_head: bundle.snapshot.head_sha,
        new_head: newHead,
        generation: 1,
        result: 'implementation-completed',
        verification: 'focused tests passed',
        preflight_sha256: bundle.snapshot.review_preflight.sha256,
      });
      applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        laneId,
        issueNumber,
        {
          kind: 'implementation-completed',
          new_head: newHead,
          verification: 'focused tests passed',
          implementer_generation: 1,
          implementer_evidence: { task_id: taskId },
        },
      );
      const snapshotPath = resolve(
        fixture.runtimeRoot,
        laneId,
        'issues',
        String(issueNumber),
        'snapshot.json',
      );
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, any>;
      snapshot.implementer_tasks[0].record_sha256 = 'f'.repeat(64);
      writeFileSync(snapshotPath, JSON.stringify(snapshot));
      expect(() =>
        loadIssueSupervisorStore(fixture.runtimeRoot, laneId, issueNumber),
      ).toThrow(/implementer receipt/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects persisted authority receipt tampering', () => {
    const fixture = setup();
    try {
      initialiseIssueSupervisorStore(fixture.runtimeRoot, identityFor(fixture.root));
      const snapshotPath = resolve(
        fixture.runtimeRoot,
        laneId,
        'issues',
        String(issueNumber),
        'snapshot.json',
      );
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, any>;
      snapshot.preflight_authority.canonical_acceptance_ids = ['issue:substituted'];
      writeFileSync(snapshotPath, JSON.stringify(snapshot));
      expect(() =>
        loadIssueSupervisorStore(fixture.runtimeRoot, laneId, issueNumber),
      ).toThrow(/tampered|authority/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
