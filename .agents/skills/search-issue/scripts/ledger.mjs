const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireArray = (record, key) => {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`${key} must be an array.`);
  }
  return value;
};

const recordsFor = (result) => {
  const records = result.records;
  if (!Array.isArray(records)) {
    throw new TypeError(`records must be an array for ${result.invocation_id}.`);
  }
  return records;
};

const reconcileInvocations = (expectedInvocations, reviewerResults) => {
  const resultsById = new Map(
    reviewerResults.map((result) => {
      if (!isRecord(result) || typeof result.invocation_id !== 'string') {
        throw new TypeError('reviewer_results require invocation_id.');
      }
      return [result.invocation_id, result];
    }),
  );

  return expectedInvocations.map((expected) => {
    const result = resultsById.get(expected.invocation_id);
    if (
      !isRecord(result) ||
      result.package !== expected.package ||
      result.reviewer !== expected.reviewer ||
      result.result_type !== expected.expected_result_type ||
      result.status !== 'completed'
    ) {
      return { ...expected, status: 'failed', result_count: null };
    }

    return {
      ...expected,
      status: 'completed',
      result_count: recordsFor(result).length,
    };
  });
};

const collectRecords = (reviewerResults, resultType) =>
  reviewerResults
    .filter((result) => result.result_type === resultType)
    .flatMap((result) =>
      recordsFor(result).map((record) => ({
        ...record,
        package: result.package,
        invocation_id: result.invocation_id,
      })),
    );

const labelsFor = (finding, domain) => {
  const severityLabel = `priority:${finding.severity.toLowerCase()}`;
  const areaLabel = domain.package_area[finding.package];
  return [
    'source:package-audit',
    severityLabel,
    ...(typeof areaLabel === 'string' ? [areaLabel] : []),
    finding.contract_impact === 'none' ? 'tech-debt' : 'bug',
  ];
};

const buildDrafts = (packages, findings, domain) =>
  packages.flatMap((packageName) => {
    const packageFindings = findings.filter(
      (finding) => finding.package === packageName,
    );
    if (packageFindings.length === 0) {
      return [];
    }

    const firstFinding = packageFindings[0];
    return [
      {
        draft_id: '',
        package: packageName,
        title: `[${packageName}] ${firstFinding.problem}`,
        findings: packageFindings,
        labels: labelsFor(firstFinding, domain),
      },
    ];
  }).map((draft, index) => ({ ...draft, draft_id: `D${index + 1}` }));

export const buildLedger = (prepared) => {
  const reviewerResults = requireArray(prepared.scenario, 'reviewer_results');
  const invocations = reconcileInvocations(prepared.invocations, reviewerResults);
  if (invocations.some((invocation) => invocation.status !== 'completed')) {
    throw new TypeError('Reviewer invocation reconciliation failed.');
  }

  const findings = collectRecords(reviewerResults, 'audit_finding');
  const rdBriefs = collectRecords(reviewerResults, 'rd_brief');
  const drafts = buildDrafts(prepared.scope.packages, findings, prepared.domain);
  return {
    version: 1,
    run_id: prepared.scenario.run_id,
    status: 'triage',
    intake: prepared.scope,
    invocations,
    findings,
    rd_briefs: rdBriefs,
    drafts,
    registration_triage: requireArray(
      prepared.scenario,
      'registration_triage',
    ),
    registration_results: [],
    handoff: null,
  };
};

export const runReadyScenario = async (prepared, outputDirectory) => {
  const ledger = buildLedger(prepared);
  const { registerAndPublish } = await import('./registration.mjs');
  return registerAndPublish({
    domain: prepared.domain,
    ledger,
    outputDirectory,
    scenario: prepared.scenario,
  });
};
