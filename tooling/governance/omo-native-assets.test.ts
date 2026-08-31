import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type SkillKind = 'entrypoint' | 'knowledge';

type SkillManifestEntry = {
  readonly kind: SkillKind;
  readonly name: string;
  readonly path: string;
};

type NativeAssetManifest = {
  readonly schemaVersion: number;
  readonly skills: readonly SkillManifestEntry[];
  readonly shippedContractPaths: readonly string[];
};

type OmoProjectConfig = Readonly<{
  task?: Readonly<{ max_depth?: number }>;
  agents?: Readonly<
    Record<
      string,
      Readonly<{
        execution_mode?: 'in-process' | 'process';
        tools?: Readonly<Record<string, boolean>>;
      }>
    >
  >;
}>;

const repoRoot = resolve(import.meta.dirname, '..', '..');
const read = (relativePath: string): string =>
  readFileSync(resolve(repoRoot, relativePath), 'utf8');

function parseFrontmatter(source: string): Readonly<Record<string, string>> {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(source);
  expect(match, 'SKILL.md must start with YAML frontmatter').not.toBeNull();
  const lines = (match?.[1] ?? '').split('\n').filter(Boolean);

  return Object.fromEntries(
    lines
      .map((line) => {
        expect(
          line,
          'SKILL.md frontmatter fields must be complete single-line YAML mappings',
        ).toMatch(/^[A-Za-z][A-Za-z0-9_-]*:\s*\S/u);
        const separator = line.indexOf(':');
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
  );
}

function parseNativeAssetManifest(): NativeAssetManifest {
  const readme = read('.agents/README.md');
  const match = /```json omo-native-assets\n([\s\S]*?)\n```/u.exec(readme);
  expect(match, '.agents/README.md must contain the native asset manifest').not.toBeNull();
  return JSON.parse(match?.[1] ?? '{}') as NativeAssetManifest;
}

const expectedEntrypoints = [
  'create-lane',
  'docs-sync-guardian',
  'execute-lane',
  'issue-to-pr',
  'pr-to-merge',
  'search-issue',
] as const;
const expectedKnowledgeSkills = [
  'fluo-contract-governance',
  'fluo-docs-governance',
  'fluo-package-audit',
  'fluo-release-operations',
] as const;
const requiredShippedContractPaths = [
  '.agents/MIGRATION.md',
  '.agents/README.md',
  '.agents/THREAT_MODEL.md',
  '.agents/VALIDATION.md',
  '.agents/skills/docs-sync-guardian/SKILL.md',
  '.agents/skills/docs-sync-guardian/references/guardian.md',
  '.agents/skills/docs-sync-guardian/references/workflow.md',
  '.agents/workflow-contracts/blocker.schema.json',
  '.agents/workflow-contracts/contracts.mjs',
  '.agents/workflow-contracts/event.schema.json',
  '.agents/workflow-contracts/lane-dag-binding.schema.json',
  '.agents/workflow-contracts/lane-ledger-v2.schema.json',
  '.agents/workflow-contracts/local-review-verdict.schema.json',
  '.agents/workflow-contracts/receipt.schema.json',
  '.agents/workflow-contracts/review-preflight.schema.json',
  '.agents/workflow-contracts/review-verdict.schema.json',
  '.agents/workflow-contracts/schema-validator.mjs',
  '.agents/workflow-contracts/search-artifact-v2.schema.json',
] as const;

describe('OMO native asset manifest', () => {
  it('keeps execute-lane workers single-depth, non-orchestrating, and in their intended modes', () => {
    const config = JSON.parse(read('.omo/omo.jsonc')) as OmoProjectConfig;
    const agents = config.agents ?? {};
    const expectedWorkerModes = {
      'fluo-issue-preflight': 'in-process',
      'fluo-issue-implementer': 'process',
      'fluo-contract-reviewer': 'in-process',
      'fluo-code-reviewer': 'in-process',
      'fluo-verification-reviewer': 'in-process',
      'fluo-issue-operator': 'process',
    } as const;

    expect(config.task?.max_depth).toBe(1);
    expect(agents['fluo-issue-supervisor']).toBeUndefined();
    for (const [workerName, expectedMode] of Object.entries(expectedWorkerModes)) {
      const worker = agents[workerName];
      expect(worker, `${workerName} must be registered`).toBeDefined();
      expect(worker?.execution_mode).toBe(expectedMode);
      expect(worker?.tools?.['task']).toBe(false);
      expect(worker?.tools?.['dag']).toBe(false);
      expect(worker?.tools?.['team_create']).toBe(false);
      expect(worker?.tools?.['task_send']).toBe(false);
    }
  });

  it('declares exactly six entrypoint skills and four knowledge skills', () => {
    const manifest = parseNativeAssetManifest();
    const namesFor = (kind: SkillKind): string[] =>
      manifest.skills
        .filter((skill) => skill.kind === kind)
        .map((skill) => skill.name)
        .sort((left, right) => left.localeCompare(right));

    expect(manifest.schemaVersion).toBe(1);
    expect(namesFor('entrypoint')).toEqual([...expectedEntrypoints]);
    expect(namesFor('knowledge')).toEqual([...expectedKnowledgeSkills]);
    expect(new Set(manifest.skills.map((skill) => skill.path)).size).toBe(10);
  });

  it('binds every manifest skill to matching required frontmatter', () => {
    const manifest = parseNativeAssetManifest();

    for (const skill of manifest.skills) {
      expect(skill.path).toBe(`.agents/skills/${skill.name}/SKILL.md`);
      expect(existsSync(resolve(repoRoot, skill.path)), `${skill.path} must exist`).toBe(true);
      const frontmatter = parseFrontmatter(read(skill.path));
      expect(frontmatter['name']).toBe(skill.name);
      expect(frontmatter['description']).toBeTruthy();
      if (skill.kind === 'knowledge') {
        expect(frontmatter['compatibility']).toBe('omo');
      }
    }
  });

  it('ships every declared workflow contract and operating document', () => {
    const manifest = parseNativeAssetManifest();

    expect([...manifest.shippedContractPaths].sort()).toEqual(
      [...requiredShippedContractPaths].sort(),
    );
    for (const path of manifest.shippedContractPaths) {
      expect(existsSync(resolve(repoRoot, path)), `${path} must exist`).toBe(true);
    }
  });

  it('registers every execute-lane governance test in validation and the dedicated plan list', () => {
    const tests = readdirSync(resolve(repoRoot, 'tooling/governance'))
      .filter((name) => /^execute-lane-.*\.test\.ts$/u.test(name))
      .map((name) => `tooling/governance/${name}`)
      .sort();
    const validation = read('.agents/VALIDATION.md');
    const plan = read('plans/three-stage-lane-workflow.md');
    for (const test of tests) {
      expect(validation, `${test} must be registered in validation`).toContain(test);
      expect(plan, `${test} must be registered in the plan`).toContain(test);
    }
  });

  it('keeps the active lane plan on native contracts instead of the read-only archive', () => {
    const plan = read('plans/three-stage-lane-workflow.md');

    expect(plan).not.toContain('.opencode-backup/commands/');
    expect(plan).toContain('.agents/skills/search-issue/SKILL.md');
    expect(plan).toContain('.agents/skills/create-lane/SKILL.md');
    expect(plan).toContain('.agents/skills/execute-lane/SKILL.md');
    expect(plan).toContain('.omo/search-issue/artifacts/');
    expect(plan).toContain('.omo/lanes/');
  });
});
