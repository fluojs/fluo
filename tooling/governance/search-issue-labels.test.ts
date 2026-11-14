import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const skillRoot = resolve(process.cwd(), '.agents/skills/search-issue');
const { buildLedger } = await import(resolve(skillRoot, 'scripts/ledger.mjs'));
const { applyTriage } = await import(resolve(skillRoot, 'scripts/registration.mjs'));
const domain = JSON.parse(readFileSync(resolve(skillRoot, 'references/domain.json'), 'utf8'));
const scenario = JSON.parse(readFileSync(
  resolve(process.cwd(), 'tooling/governance/fixtures/search-issue-native/full-registration.json'),
  'utf8',
));

const prepared = {
  domain,
  scenario,
  scope: { packages: scenario.intake.packages },
  invocations: scenario.reviewer_results.map((result: {
    readonly invocation_id: string;
    readonly package: string;
    readonly reviewer: string;
    readonly result_type: string;
  }) => ({
    invocation_id: result.invocation_id,
    package: result.package,
    reviewer: result.reviewer,
    expected_result_type: result.result_type,
  })),
};

describe('$search-issue package labels', () => {
  it.each([['P2', 'P0'], ['P0', 'P2']])(
    'buildLedger: severity order %s/%s retains the highest priority',
    (first, second) => {
      const input = structuredClone(prepared);
      const result = input.scenario.reviewer_results[0];
      result.records = [first, second].map((severity) => ({
        ...result.records[0], severity, problem: `Finding ${severity}`,
      }));
      input.scenario.registration_triage[0].labels =
        input.scenario.registration_triage[0].labels.map((label: string) =>
          label.startsWith('priority:') ? 'priority:p0' : label);

      const ledger = buildLedger(input);

      expect(ledger.drafts[0].labels).toContain('priority:p0');
      expect(ledger.drafts[0].labels).not.toContain('priority:p2');
    },
  );
  it('buildLedger: duplicate evidence retains its highest severity and stable draft identity', () => {
    const input = structuredClone(prepared);
    const result = input.scenario.reviewer_results[0];
    result.records = ['P2', 'P1'].map((severity) => ({ ...result.records[0], severity }));
    input.scenario.registration_triage[0].decision = 'defer';

    const ledger = buildLedger(input);

    expect(ledger.findings.filter((finding: { package: string }) => finding.package === 'runtime'))
      .toHaveLength(1);
    expect(ledger.drafts[0]).toMatchObject({ draft_id: 'D1', package: 'runtime',
      labels: expect.arrayContaining(['priority:p1']) });
  });
  it('catalog: every group member maps to its allowed area and package labels', () => {
    // Given / When
    const members = Object.entries<readonly string[]>(domain.groups)
      .flatMap(([group, packages]) => packages.map((name) => ({ group, name })));

    // Then
    expect(members.map(({ name }) => name).sort()).toEqual([...domain.packages].sort());
    expect(domain.labels.filter((label: string) => label.startsWith('area:')).sort())
      .toEqual(Object.keys(domain.groups).map((group) => `area:${group}`).sort());
    expect(domain.labels.filter((label: string) => label.startsWith('pkg:')).sort())
      .toEqual(domain.packages.map((name: string) => `pkg:${name}`).sort());
    for (const { group, name } of members) {
      expect(domain.package_area[name]).toBe(`area:${group}`);
    }
  });

  it('buildLedger: findings carry both owning group and individual package labels', () => {
    // Given / When
    const ledger = buildLedger(prepared);

    // Then
    expect(ledger.drafts).toMatchObject([
      { package: 'runtime', labels: expect.arrayContaining(['area:foundation', 'pkg:runtime']) },
      { package: 'http', labels: expect.arrayContaining(['area:http-runtime', 'pkg:http']) },
    ]);
  });

  it.each(['area:foundation', 'pkg:runtime'])(
    'applyTriage: registration without required %s label is rejected',
    (missingLabel) => {
      // Given
      const ledger = buildLedger(prepared);
      const registration_triage = ledger.registration_triage.map((decision: {
        readonly labels: readonly string[];
      }) => ({
        ...decision,
        labels: decision.labels.filter((label) => label !== missingLabel),
      }));

      // When / Then
      expect(() => applyTriage({
        domain,
        ledger: { ...ledger, registration_triage },
        scenario,
      })).toThrow('Missing package labels for D1.');
    },
  );
});
