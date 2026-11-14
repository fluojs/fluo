const unique = (values) => [...new Set(values)];
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item);

export const collectRecords = (invocations, type) => {
  const records = invocations.flatMap((invocation) =>
    invocation.result.result_type === type
      ? invocation.result.records.map((record) => ({
          ...record, package: invocation.package, invocation_id: invocation.invocation_id,
        }))
      : []);
  const deduplicated = new Map();
  for (const record of records) {
    const key = canonical({
      package: record.package,
      evidence: [...(record.evidence ?? record.evidence_basis ?? [])].sort(),
      theme: record.problem_theme ?? record.problem ?? record.user_problem,
      contract_impact: record.contract_impact,
      affected_surfaces: [...(record.affected_surfaces ?? [])].sort(),
    });
    const previous = deduplicated.get(key);
    if (!previous || (record.severity && record.severity < previous.severity)) {
      deduplicated.set(key, record);
    }
  }
  return [...deduplicated.values()];
};

export const buildDrafts = ({ packages, findings, rdBriefs, domain }) =>
  packages.flatMap((packageName) => {
    const packageFindings = findings.filter((finding) => finding.package === packageName);
    const briefs = rdBriefs.filter((brief) =>
      brief.package === packageName && brief.issue_eligibility === 'register');
    if (packageFindings.length + briefs.length === 0) return [];
    const severity = ['P0', 'P1', 'P2'].find((level) =>
      packageFindings.some((finding) => finding.severity === level)) ?? 'P2';
    return [{
      draft_id: '', package: packageName, packages: [packageName],
      title: `[${packageName}] ${packageFindings[0]?.problem ?? briefs[0].user_problem}`,
      findings: packageFindings, rd_briefs: briefs,
      labels: unique([
        'source:package-audit', `priority:${severity.toLowerCase()}`,
        domain.package_area[packageName], `pkg:${packageName}`,
        packageFindings.length === 0 ? 'enhancement' :
          packageFindings.some((finding) => finding.contract_impact !== 'none') ? 'bug' : 'tech-debt',
      ]),
    }];
  }).map((draft, index) => ({ ...draft, draft_id: `D${index + 1}` }));

// The default stays package-local. Cross-package bundling is deliberately not inferred.
export const draftState = (ledger, domain) => {
  const findings = collectRecords(ledger.invocations, 'audit_finding');
  const rdBriefs = collectRecords(ledger.invocations, 'rd_brief');
  return {
    findings, rd_briefs: rdBriefs,
    drafts: buildDrafts({ packages: ledger.intake.packages, findings, rdBriefs, domain }),
  };
};
