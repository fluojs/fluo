import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const realLaneDirectory = resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'],
  { cwd: root, encoding: 'utf8' }).trim(), '..', '.omo/lanes');
const skill = resolve(root, '.agents/skills/create-lane/scripts');
const { approvalBinding } = await import(resolve(skill, 'approval-contracts.mjs'));
const { assertLaneSourceBinding } = await import(resolve(root, '.agents/workflow-contracts/contracts.mjs'));
const { validateLedger } = await import(resolve(root, 'tooling/governance/lane-ledger-state.mjs'));
const fixture = () => {
  const value = JSON.parse(readFileSync(resolve(root,
    'tooling/governance/fixtures/create-lane-native/valid-multi-issue.json'), 'utf8'));
  value.plan.preflight_overlap = 1;
  value.plan.dependency_reasons = [{ issue: 4103, depends_on: 4101, reason: 'Acceptance needs the runtime fix.' }];
  const artifact = value.artifacts[value.intake.artifact_path];
  value.approvals = value.approvals.map((approval: Readonly<Record<string, unknown>>) => ({
    ...approval, binding_sha256: approvalBinding(approval, artifact, value.plan),
  }));
  return value;
};
const snapshot = (path: string): unknown => existsSync(path)
  ? lstatSync(path).isSymbolicLink() ? { link: readlinkSync(path) }
    : Object.fromEntries(readdirSync(path, { withFileTypes: true }).map((entry) => [
      entry.name, entry.isSymbolicLink() ? { link: readlinkSync(resolve(path, entry.name)) }
        : entry.isDirectory() ? snapshot(resolve(path, entry.name)) : readFileSync(resolve(path, entry.name), 'utf8'),
    ]))
  : null;
const sandbox = () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'fluo-4096-publish-'));
  const value = fixture();
  const artifactPath = resolve(temp, value.intake.artifact_path);
  mkdirSync(resolve(artifactPath, '..'), { recursive: true });
  writeFileSync(artifactPath, JSON.stringify(value.artifacts[value.intake.artifact_path]));
  const input = {
    artifact_path: value.intake.artifact_path, plan: value.plan, approvals: value.approvals,
    recommend_issues: value.recommend_issues, recommended_issue_numbers: value.recommended_issue_numbers,
  };
  return { temp, value, input };
};
const run = (temp: string, input: unknown, fixtureOnly = false) => {
  const path = resolve(temp, fixtureOnly ? 'fixture.json' : 'input.json');
  writeFileSync(path, JSON.stringify(input));
  return JSON.parse(execFileSync(process.execPath, fixtureOnly
    ? [resolve(skill, 'fixtures/run-scenario.mjs'), '--fixture-only', '--scenario', path, '--out', temp]
    : [resolve(skill, 'publish.mjs'), '--input', path, '--root', temp], { encoding: 'utf8' }));
};

describe('create-lane real publication boundary', () => {
  it('fixture CLI: generated intake collides -> keeps generated artifact and original plan, rolls back receipts', () => {
    const temp = mkdtempSync(resolve(tmpdir(), 'fluo-4096-generated-'));
    const value = JSON.parse(readFileSync(resolve(root,
      'tooling/governance/fixtures/create-lane-native/valid-number-intake.json'), 'utf8'));
    try {
      mkdirSync(resolve(temp, '.omo/lanes'), { recursive: true });
      writeFileSync(resolve(temp, '.omo/lanes/lane-4101-runtime.json'), 'existing lane');

      expect(run(temp, value, true)).toEqual({ status: 'rejected', reason: 'target_collision' });

      const artifact = JSON.parse(readFileSync(resolve(temp,
        '.omo/search-issue/artifacts/search-native-runtime.json'), 'utf8'));
      expect(artifact.selected_issues).toEqual([4101]);
      expect(artifact.sha256).toBe(value.plan.source.sha256);
      expect(readFileSync(resolve(temp, '.omo/lanes/lane-4101-runtime.json'), 'utf8')).toBe('existing lane');
      expect(readdirSync(resolve(temp, '.omo/approvals'))).toEqual([]);
      expect(Object.hasOwn(value.plan, 'dependency_reasons')).toBe(false);
      expect(Object.hasOwn(value.plan, 'preflight_overlap')).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('publish CLI and fixture CLI: same trusted input -> identical ledgers, receipts and v4 imports', () => {
    const production = sandbox();
    const fixtureRun = sandbox();
    const realBefore = snapshot(realLaneDirectory);
    try {
      expect(run(production.temp, production.input)).toEqual({ status: 'ready',
        ledger: '.omo/lanes/lane-4101-4103-runtime.json' });
      expect(run(fixtureRun.temp, fixtureRun.value, true)).toEqual({ status: 'ready',
        ledger: '.omo/lanes/lane-4101-4103-runtime.json' });
      expect(snapshot(resolve(production.temp, '.omo/lanes'))).toEqual(snapshot(resolve(fixtureRun.temp, '.omo/lanes')));
      expect(snapshot(resolve(production.temp, '.omo/approvals'))).toEqual(snapshot(resolve(fixtureRun.temp, '.omo/approvals')));
      expect(readdirSync(resolve(production.temp, '.omo/approvals'))).toHaveLength(3);
      for (const { temp, value } of [production, fixtureRun]) {
        const path = resolve(temp, '.omo/lanes/lane-4101-4103-runtime.json');
        const ledger = JSON.parse(readFileSync(path, 'utf8'));
        expect(() => assertLaneSourceBinding(ledger, value.artifacts[value.intake.artifact_path])).not.toThrow();
        expect(() => validateLedger(path, ledger)).not.toThrow();
        execFileSync(process.execPath, [resolve(root, '.agents/skills/execute-lane/scripts/lane-v4-cli.mjs'),
          'init', '--root', temp, '--from-lane-v2', path], { encoding: 'utf8' });
      }
      const execution = (temp: string) => {
        const ledger = JSON.parse(readFileSync(resolve(temp, '.omo/lanes-v4/lane-4101-4103-runtime.json'), 'utf8'));
        delete ledger.source_ledger.path;
        return ledger;
      };
      expect(execution(production.temp)).toEqual(execution(fixtureRun.temp));
      expect(snapshot(realLaneDirectory)).toEqual(realBefore);
    } finally {
      for (const { temp } of [production, fixtureRun]) rmSync(temp, { recursive: true, force: true });
    }
  });

  for (const [mode, reason] of [
    ['approval', 'approval_not_distinct'], ['substitution', 'invalid_artifact'],
    ['replay', 'approval_replayed'], ['receipt-replay', 'approval_replayed'],
    ['collision', 'target_collision'], ['symlink', 'unsafe_output_path'],
    ['artifact-symlink', 'unsafe_output_path'], ['missing-reasons', 'invalid_artifact'],
    ['missing-marker', 'invalid_artifact'], ['fixture-map', 'invalid_artifact'],
  ]) {
    it(`publish CLI: ${mode} -> rejects and preserves existing files`, () => {
      const { temp, value, input } = sandbox();
      const realBefore = snapshot(realLaneDirectory);
      try {
        if (mode === 'approval') input.approvals[0].approved = false;
        if (mode === 'substitution') {
          const artifact = value.artifacts[value.intake.artifact_path];
          artifact.selected_issues = [9999];
          writeFileSync(resolve(temp, input.artifact_path), JSON.stringify(artifact));
        }
        if (mode === 'missing-reasons') delete input.plan.dependency_reasons;
        if (mode === 'missing-marker') delete input.plan.preflight_overlap;
        if (mode === 'replay') run(temp, input);
        if (mode === 'receipt-replay') {
          mkdirSync(resolve(temp, '.omo/approvals'));
          writeFileSync(resolve(temp, '.omo/approvals', `${input.approvals[1].approval_id}.json`), 'existing receipt');
        }
        if (mode === 'collision') {
          mkdirSync(resolve(temp, '.omo/lanes'));
          writeFileSync(resolve(temp, '.omo/lanes/lane-4101-4103-runtime.json'), 'existing');
        }
        if (mode === 'symlink') {
          mkdirSync(resolve(temp, 'outside'));
          symlinkSync(resolve(temp, 'outside'), resolve(temp, '.omo/lanes'));
        }
        if (mode === 'artifact-symlink') {
          const artifactPath = resolve(temp, input.artifact_path);
          const bytes = readFileSync(artifactPath, 'utf8');
          rmSync(artifactPath);
          writeFileSync(resolve(temp, 'artifact.json'), bytes);
          symlinkSync(resolve(temp, 'artifact.json'), artifactPath);
        }
        const before = snapshot(resolve(temp, '.omo'));

        const result = run(temp, mode === 'fixture-map' ? { ...input, artifacts: value.artifacts } : input);

        expect(result).toEqual({ status: 'rejected', reason });
        // Publication may create empty output directories, but must retain every existing byte.
        for (const name of ['lanes', 'approvals', 'search-issue']) {
          const prior = existsSync(resolve(temp, '.omo', name)) && before !== null
            ? Reflect.get(Object(before), name) : undefined;
          if (prior !== undefined) expect(snapshot(resolve(temp, '.omo', name))).toEqual(prior);
        }
        if (mode === 'collision') expect(readdirSync(resolve(temp, '.omo/approvals'))).toEqual([]);
        if (mode === 'receipt-replay') {
          expect(readdirSync(resolve(temp, '.omo/approvals'))).toEqual([`${input.approvals[1].approval_id}.json`]);
        }
        expect(snapshot(realLaneDirectory)).toEqual(realBefore);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  }
});
