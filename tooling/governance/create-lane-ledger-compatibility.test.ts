import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const { planIsCanonical, readyLedger } = await import(resolve(root, '.agents/skills/create-lane/scripts/plan-contracts.mjs'));
const { approvalBinding } = await import(resolve(root, '.agents/skills/create-lane/scripts/approval-contracts.mjs'));
const { assertContract, assertSameHeadReview } = await import(resolve(root, '.agents/workflow-contracts/contracts.mjs'));
const { validateLedger } = await import(resolve(root, 'tooling/governance/lane-ledger-state.mjs'));
const { laneV2ToInitSpecs, sourceLedgerRef } = await import(resolve(root, '.agents/skills/execute-lane/scripts/lane-v4-cli.mjs'));
const fixture = () => JSON.parse(readFileSync(resolve(root,
  'tooling/governance/fixtures/create-lane-native/valid-multi-issue.json'), 'utf8'));
const rootState = ['execution', 'completed_issues', 'issue_progress', 'root_main_sync'];
const laneState = ['current_issue', 'status', 'branch', 'worktree', 'pr', 'retry_count'];
const legacy = () => {
  const value = fixture();
  return {
    ...readyLedger(value.plan, value.artifacts[value.intake.artifact_path], value.intake.artifact_path),
    execution: { status: 'not-started', last_command: null, last_updated: null },
    completed_issues: [], issue_progress: {},
    suggested_but_excluded: [], backlog_candidates: [],
    root_main_sync: { status: 'not-started', sha: null },
    lanes: value.plan.lanes.map((lane: { name: string; queue: number[] }) => ({
      ...lane, current_issue: lane.queue[0], status: 'queued',
      branch: null, worktree: null, pr: null, retry_count: 0,
    })),
  };
};
const validators = [
  (ledger: unknown) => assertContract('lane-ledger-v2', ledger),
  (ledger: unknown) => validateLedger('compatibility', ledger),
];

describe('create-lane planning storage compatibility', () => {
  it('readyLedger: new planning value -> validates without legacy state or input mutation', () => {
    const value = fixture();
    const before = JSON.stringify(value);
    const ledger = readyLedger(value.plan, value.artifacts[value.intake.artifact_path], value.intake.artifact_path);

    for (const key of [...rootState, 'suggested_but_excluded', 'backlog_candidates']) {
      expect(Object.hasOwn(ledger, key)).toBe(false);
    }
    expect(ledger.lanes).toEqual(value.plan.lanes);
    for (const validate of validators) expect(() => validate(ledger)).not.toThrow();
    expect(JSON.stringify(value)).toBe(before);
    expect(laneV2ToInitSpecs(ledger).specs).toHaveLength(3);
  });

  for (const key of [...rootState, ...laneState]) {
    it(`validators: partial legacy missing ${key} -> rejected without backfill`, () => {
      const ledger = legacy();
      const target = rootState.includes(key) ? ledger : ledger.lanes[0];
      delete target[key];
      const before = JSON.stringify(ledger);

      for (const validate of validators) expect(() => validate(ledger)).toThrow();
      expect(JSON.stringify(ledger)).toBe(before);
    });
  }

  it('validators: full legacy -> accepted with byte-bound source and original approval digest', () => {
    const value = fixture();
    const ledger = legacy();
    const temp = mkdtempSync(resolve(tmpdir(), 'fluo-4096-legacy-'));
    const bytes = `${JSON.stringify(ledger, null, 2)}\n`;
    const path = resolve(temp, 'lane.json');
    try {
      writeFileSync(path, bytes);

      for (const validate of validators) expect(() => validate(ledger)).not.toThrow();
      expect(sourceLedgerRef(path, bytes).sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(planIsCanonical(value.plan, value.artifacts[value.intake.artifact_path])).toBe(true);
      for (const approval of value.approvals) {
        expect(approvalBinding(approval, value.artifacts[value.intake.artifact_path], value.plan)).toBe(approval.binding_sha256);
      }
      expect(readFileSync(path, 'utf8')).toBe(bytes);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  const reason = { issue: 4103, depends_on: 4101, reason: 'Tests require the runtime fix.' };
  for (const reasons of [
    [], [reason, reason], [{ ...reason, reason: ' ' }],
    [{ ...reason, depends_on: 4102 }], [{ ...reason, extra: true }],
    [{ ...reason, issue: Number.MAX_SAFE_INTEGER + 1 }], [{ ...reason, depends_on: 0 }],
    [{ ...reason, issue: '4103' }], null, undefined,
  ]) {
    it(`dependency reasons: malformed coverage ${JSON.stringify(reasons)} -> rejected by every boundary`, () => {
      const value = fixture();
      const plan = { ...value.plan, dependency_reasons: reasons };
      const ledger = { ...legacy(), dependency_reasons: reasons };

      expect(planIsCanonical(plan, value.artifacts[value.intake.artifact_path])).toBe(false);
      for (const validate of validators) expect(() => validate(ledger)).toThrow();
    });
  }

  it('dependency reasons: covered edges -> retained and approval-bound but absent from execution specs', () => {
    const value = fixture();
    const artifact = value.artifacts[value.intake.artifact_path];
    const plan = { ...value.plan, dependency_reasons: [reason] };
    const ledger = readyLedger(plan, artifact, value.intake.artifact_path);

    expect(planIsCanonical(plan, artifact)).toBe(true);
    for (const validate of validators) expect(() => validate(ledger)).not.toThrow();
    expect(ledger.dependency_reasons).toEqual([reason]);
    expect(approvalBinding(value.approvals[2], artifact, plan)).not.toBe(value.approvals[2].binding_sha256);
    expect(approvalBinding(value.approvals[2], artifact, {
      ...plan, dependency_reasons: [{ ...reason, reason: 'Changed acceptance evidence.' }],
    })).not.toBe(approvalBinding(value.approvals[2], artifact, plan));
    expect(laneV2ToInitSpecs(ledger)).toEqual(laneV2ToInitSpecs(legacy()));
  });

  for (const mutation of [
    { created_by: 'other' }, { authority_scope: {} }, { source: {} },
    { base_branch: 'bad..branch' }, { unknown: true }, { status: 'running' },
  ]) {
    it(`validators: malformed planning properties ${JSON.stringify(mutation)} -> remain checked`, () => {
      const value = fixture();
      const ledger = { ...readyLedger(value.plan, value.artifacts[value.intake.artifact_path],
        value.intake.artifact_path), ...mutation };

      for (const validate of validators) expect(() => validate(ledger)).toThrow();
    });
  }

  it('dependency reasons: empty graph or external edge -> preserves producer/import boundary', () => {
    const value = fixture();
    const artifact = value.artifacts[value.intake.artifact_path];
    const empty = { ...value.plan, dependency_graph: {}, dependency_reasons: [] };
    const external = { ...value.plan, dependency_graph: { '4103': [9999] },
      dependency_reasons: [{ issue: 4103, depends_on: 9999, reason: 'Requires external prerequisite.' }] };

    expect(planIsCanonical(empty, artifact)).toBe(true);
    expect(planIsCanonical(external, artifact)).toBe(true);
    for (const plan of [empty, external]) {
      for (const validate of validators) expect(() => validate(readyLedger(plan, artifact, value.intake.artifact_path))).not.toThrow();
    }
    expect(() => laneV2ToInitSpecs(readyLedger(external, artifact, value.intake.artifact_path))).toThrow();
  });

  it('dependency reasons: string prerequisite -> cannot impersonate a numeric graph edge', () => {
    const ledger = { ...legacy(), dependency_graph: { '4103': ['4101'] },
      dependency_reasons: [reason] };

    for (const validate of validators) expect(() => validate(ledger)).toThrow();
  });

  it('assertSameHeadReview: planning has no head -> fails closed with the canonical error', () => {
    const value = fixture();
    const ledger = readyLedger(value.plan, value.artifacts[value.intake.artifact_path], value.intake.artifact_path);
    const verdict = {
      version: 1, lane_id: ledger.lane_id, issue_number: 4101, reviewer: 'code',
      verdict: 'pass', head_sha: 'a'.repeat(40), blockers: [],
    };

    expect(() => assertSameHeadReview(verdict, ledger)).toThrow('review must bind the same head and lane identity');
    const historical = legacy();
    historical.issue_progress = { '4101': { head_sha: verdict.head_sha } };
    expect(() => assertSameHeadReview(verdict, historical)).not.toThrow();
    expect(() => assertSameHeadReview({ ...verdict, head_sha: 'b'.repeat(40) }, historical)).toThrow();
  });
});
