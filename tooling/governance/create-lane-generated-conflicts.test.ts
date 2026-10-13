import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const { planIsCanonical, readyLedger } = await import(resolve(root, '.agents/skills/create-lane/scripts/plan-contracts.mjs'));
const { searchArtifactDigest, assertLaneSourceBinding } = await import(resolve(root, '.agents/workflow-contracts/contracts.mjs'));
const { validateLedger } = await import(resolve(root, 'tooling/governance/lane-ledger-state.mjs'));
const { approvalBinding, validateApprovals } = await import(resolve(root, '.agents/skills/create-lane/scripts/approval-contracts.mjs'));
const { laneV2ToInitSpecs } = await import(resolve(root, '.agents/skills/execute-lane/scripts/lane-v4-cli.mjs'));
const { generatedConsumerGraph, withGeneratedConflicts } = await import(resolve(root, '.agents/skills/create-lane/scripts/generated-conflicts.mjs'));
const { prepareScenario } = await import(resolve(root, '.agents/skills/create-lane/scripts/contracts.mjs'));

const artifact = {
  version: 2, artifact_id: 'search:generated-fixture', search_run_id: 'generated-fixture',
  selected_issues: [42, 43], sha256: '',
};
artifact.sha256 = searchArtifactDigest(artifact);
const plan = {
  version: 2, lane_id: 'generated-fixture', base_branch: 'main',
  source: { artifact_id: artifact.artifact_id, sha256: artifact.sha256 },
  merge_policy: 'supervisor-auto', pr_merge_method: 'squash',
  authority_scope: { issue_creation: false, pr_creation: true, pr_merge: true,
    cleanup_command_worktrees: true, root_main_sync_ff_only: true, publish_via_github_actions: false },
  retry_policy: { retry_count_is_terminal: false, max_same_failure_repeats: null,
    max_wall_clock_minutes: null, stop_on_child_contract_error: true },
  confirmed_issues: [42, 43], suggested_but_excluded: [], backlog_candidates: [], release_handoffs: [],
  lanes: [{ name: 'first', queue: [42] }, { name: 'second', queue: [43] }], dependency_graph: {},
};
const hint = { surface: 'examples/react-vite-ssr/src/generated/react-pages.ts', issues: [42, 43] };
const withHint = { ...plan, predicted_conflicts: [hint] };
const ledger = () => readyLedger(withHint, artifact, '.omo/search-issue/artifacts/generated-fixture.json');

describe('create-lane generated conflicts', () => {
  it.each([0, 1])(
    'producer: valid old hint and %i current consumers -> stale hint removed through digest ledger and init',
    (consumerCount) => {
      const graph = { surface: hint.surface, command: 'node generator.mjs --check',
        inputs: [{ path: 'packages/react/src/typegen.ts', sha256: 'a'.repeat(64) }] };
      const previous = withGeneratedConflicts(plan, [42, 43].map((issue) => ({
        issue, title: 'Consumer change', body: 'packages/react/src/typegen.ts',
      })), graph);
      expect(planIsCanonical(previous, artifact)).toBe(true);
      const observations = [42, 43].map((issue, index) => ({
        issue, title: 'Updated same-member issue',
        body: index < consumerCount ? 'packages/react/src/typegen.ts' : '.github/workflows/ci.yml',
      }));
      const approval = { gate: 'lane-plan', approval_id: `approval-${plan.lane_id}-lane-plan`,
        approved: true, release_handoff_attestations: [] };

      const updated = withGeneratedConflicts(previous, observations, graph);

      expect(updated.predicted_conflicts ?? []).toEqual([]);
      expect(planIsCanonical(updated, artifact)).toBe(true);
      expect(approvalBinding(approval, artifact, updated)).not.toBe(approvalBinding(approval, artifact, previous));
      const value = readyLedger(updated, artifact, '.omo/search-issue/artifacts/generated-fixture.json');
      expect(value.predicted_conflicts ?? []).toEqual([]);
      expect(() => assertLaneSourceBinding(value, artifact)).not.toThrow();
      expect(() => validateLedger('fixture', value)).not.toThrow();
      expect(laneV2ToInitSpecs(value).predictedConflicts ?? []).toEqual([]);
      expect(previous.predicted_conflicts).toHaveLength(1);
    },
  );

  it.each([0, 1])(
    'producer: %i current consumers and unrelated hint -> only stale consumer hint removed',
    (consumerCount) => {
      const graph = { surface: hint.surface, command: 'node generator.mjs --check',
        inputs: [{ path: 'packages/react/src/typegen.ts', sha256: 'a'.repeat(64) }] };
      const unrelated = { surface: 'tooling/governance/lane-ledger-schema.mjs', issues: [42, 43] };
      const previous = withGeneratedConflicts({ ...plan, predicted_conflicts: [unrelated] },
        [42, 43].map((issue) => ({ issue, title: 'Consumer change', body: 'packages/react/src/typegen.ts' })), graph);
      expect(planIsCanonical(previous, artifact)).toBe(true);

      const updated = withGeneratedConflicts(previous, [42, 43].map((issue, index) => ({
        issue, title: 'Updated same-member issue',
        body: index < consumerCount ? 'packages/react/src/typegen.ts' : '.github/workflows/ci.yml',
      })), graph);

      expect(updated.predicted_conflicts).toEqual([unrelated]);
      const value = readyLedger(updated, artifact, '.omo/search-issue/artifacts/generated-fixture.json');
      expect(() => assertLaneSourceBinding(value, artifact)).not.toThrow();
      expect(() => validateLedger('fixture', value)).not.toThrow();
      expect(laneV2ToInitSpecs(value).predictedConflicts).toEqual([unrelated]);
      expect(previous.predicted_conflicts).toHaveLength(2);
    },
  );

  it('planIsCanonical: supported hint -> accepted without dependency edges', () => {
    expect(planIsCanonical(withHint, artifact)).toBe(true);
  });

  it('readyLedger: supported hint -> source-bound validators retain hint', () => {
    const value = ledger();

    expect(value.predicted_conflicts).toEqual([hint]);
    expect(() => assertLaneSourceBinding(value, artifact)).not.toThrow();
    expect(() => validateLedger('generated-fixture', value)).not.toThrow();
    expect(value.dependency_graph).toEqual({});
  });

  it('validators: supported optional root field -> accepted without relaxing unknown keys', () => {
    const value = { ...readyLedger(plan, artifact, '.omo/search-issue/artifacts/generated-fixture.json'), predicted_conflicts: [hint] };

    expect(() => assertLaneSourceBinding(value, artifact)).not.toThrow();
    expect(() => validateLedger('generated-fixture', value)).not.toThrow();
    expect(() => assertLaneSourceBinding({ ...value, surprise: true }, artifact)).toThrow();
    expect(() => validateLedger('generated-fixture', { ...value, surprise: true })).toThrow();
  });

  it('approvalBinding: substituted planning evidence -> receipt rejected', () => {
    const approvals = ['confirmed-issues', 'suggested-additions', 'lane-plan'].map((gate) => {
      const approval = { gate, approval_id: `approval-${plan.lane_id}-${gate}`, approved: true,
        ...(gate === 'lane-plan' ? { release_handoff_attestations: [] }
          : { issue_numbers: gate === 'confirmed-issues' ? [42, 43] : [] }) };
      return { ...approval, binding_sha256: approvalBinding(approval, artifact, withHint) };
    });

    expect(validateApprovals(approvals, artifact, withHint, [])).toBeNull();
    expect(validateApprovals(approvals, artifact, { ...withHint, predicted_conflicts: [] }, [])).toBe('approval_binding_mismatch');
  });

  it('v4 init: planning hints -> retained without serializing independent issues', () => {
    const value = { ...readyLedger(plan, artifact, '.omo/search-issue/artifacts/generated-fixture.json'), predicted_conflicts: [hint] };

    expect(laneV2ToInitSpecs(value).predictedConflicts).toEqual([hint]);
    expect(laneV2ToInitSpecs(value).specs).toEqual([{ n: 42, deps: [] }, { n: 43, deps: [] }]);
    expect(planIsCanonical(plan, artifact)).toBe(true);
  });

  it.each(['../escape.ts', '/absolute.ts', 'examples/../escape.ts', 'examples\\escape.ts', 'examples/**', ''])(
    'validators: malformed surface %s -> both boundaries reject',
    (surface) => {
      const value = { ...ledger(), predicted_conflicts: [{ ...hint, surface }] };

      expect(() => assertLaneSourceBinding(value, artifact)).toThrow();
      expect(() => validateLedger('fixture', value)).toThrow();
      expect(planIsCanonical({ ...withHint, predicted_conflicts: [{ ...hint, surface }] }, artifact)).toBe(false);
    },
  );

  it.each([[42, 42], [42, 99], [42], [42, 43, 43]])(
    'validators: noncanonical membership %j -> both boundaries reject',
    (...issues) => {
      const value = { ...ledger(), predicted_conflicts: [{ ...hint, issues }] };

      expect(() => assertLaneSourceBinding(value, artifact)).toThrow();
      expect(() => validateLedger('fixture', value)).toThrow();
    },
  );

  it('producer: actual compiler source/config graph -> receipt/schema/v4 init roundtrip', () => {
    const graph = generatedConsumerGraph(root);
    const produced = withGeneratedConflicts(plan, [
      { issue: 42, title: 'Adjust typegen', body: 'packages/cli/src/commands/typegen-compiler.ts' },
      { issue: 43, title: 'Adjust consumer types', body: 'packages/react/src/typegen.ts' },
      { issue: 99, title: 'Unrelated', body: '.github/workflows/ci.yml' },
    ], graph);
    const approvals = ['confirmed-issues', 'suggested-additions', 'lane-plan'].map((gate) => {
      const approval = { gate, approval_id: `approval-${plan.lane_id}-${gate}`, approved: true,
        ...(gate === 'lane-plan' ? { release_handoff_attestations: [] }
          : { issue_numbers: gate === 'confirmed-issues' ? [42, 43] : [] }) };
      return { ...approval, binding_sha256: approvalBinding(approval, artifact, produced) };
    });
    const temporary = mkdtempSync(resolve(tmpdir(), 'fluo-generated-planning-'));
    try {
      const scenario = resolve(temporary, 'scenario.json');
      writeFileSync(scenario, JSON.stringify({
        intake: { mode: 'artifact', artifact_path: '.omo/search-issue/artifacts/generated-fixture.json' },
        artifacts: { '.omo/search-issue/artifacts/generated-fixture.json': artifact },
        recommended_issue_numbers: [], approvals, plan: produced,
      }));
      const prepared = prepareScenario(scenario);
      expect(prepared.kind).toBe('ready');
      expect(graph.inputs.map((input: { path: string }) => input.path)).toEqual(expect.arrayContaining([
        'examples/react-vite-ssr/tsconfig.json', 'examples/tsconfig.json', 'tsconfig.base.json',
        'packages/cli/src/commands/typegen-compiler.ts', 'packages/react/src/typegen.ts',
      ]));
      expect(prepared.ledger.dependency_graph).toEqual({});
      expect(() => assertLaneSourceBinding(prepared.ledger, artifact)).not.toThrow();
      expect(() => validateLedger('fixture', prepared.ledger)).not.toThrow();
      const ledgerPath = resolve(temporary, 'ledger.json');
      writeFileSync(ledgerPath, JSON.stringify(prepared.ledger));
      const path = execFileSync(process.execPath, [
        resolve(root, '.agents/skills/execute-lane/scripts/lane-v4-cli.mjs'),
        'init', '--root', temporary, '--from-lane-v2', ledgerPath,
      ], { encoding: 'utf8' }).trim();
      const imported = JSON.parse(readFileSync(path, 'utf8'));
      expect(imported.predicted_conflicts).toEqual(produced.predicted_conflicts);
      expect(imported.issues['42'].depends_on).toEqual([]);
      const substituted = structuredClone(prepared.ledger);
      substituted.predicted_conflicts[0].generated.inputs[0].sha256 = 'f'.repeat(64);
      expect(() => assertLaneSourceBinding(substituted, artifact)).toThrow();
      expect(() => validateLedger('fixture', substituted)).toThrow();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
