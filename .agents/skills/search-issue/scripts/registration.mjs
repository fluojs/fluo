const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (record, key) => {
  const value = record[key];
  if (!isRecord(value)) {
    throw new TypeError(`${key} must be an object.`);
  }
  return value;
};

const validateTriage = (ledger, labelAllowlist) => {
  const draftsById = new Map(
    ledger.drafts.map((draft) => [draft.draft_id, draft]),
  );
  const allowedLabels = new Set(labelAllowlist);

  return ledger.registration_triage.map((decision) => {
    const draft = draftsById.get(decision.draft_id);
    if (draft === undefined) {
      throw new TypeError(`Unknown triage draft: ${decision.draft_id}.`);
    }
    if (!['register', 'defer', 'reject'].includes(decision.decision)) {
      throw new TypeError(`Invalid triage decision: ${decision.decision}.`);
    }
    if (
      !Array.isArray(decision.labels) ||
      decision.labels.some((label) => !allowedLabels.has(label))
    ) {
      throw new TypeError(`Invalid labels for ${decision.draft_id}.`);
    }
    if (
      decision.decision === 'register' &&
      (decision.safety_route !== 'public-issue' ||
        !['high', 'medium'].includes(decision.confidence))
    ) {
      throw new TypeError(`Unsafe registration decision: ${decision.draft_id}.`);
    }
    return { decision, draft };
  });
};

export const applyTriage = ({ domain, ledger, scenario }) => {
  const authority = requireRecord(scenario, 'authority');
  const fakeIssueNumbers = requireRecord(scenario, 'fake_issue_numbers');
  const triaged = validateTriage(ledger, domain.labels);
  const canRegister =
    authority.explicit_harness_invocation === true &&
    authority.investigation_only === false;

  const registrationResults = triaged.map(({ decision }) => {
    if (decision.decision !== 'register' || !canRegister) {
      return {
        draft_id: decision.draft_id,
        decision: decision.decision,
        issue_number: null,
      };
    }

    const issueNumber = fakeIssueNumbers[decision.draft_id];
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
      throw new TypeError(`Missing fake issue number for ${decision.draft_id}.`);
    }
    return {
      draft_id: decision.draft_id,
      decision: 'register',
      issue_number: issueNumber,
    };
  });

  const ghCalls = registrationResults
    .filter((result) => result.issue_number !== null)
    .map(({ draft_id, issue_number }) => ({ draft_id, issue_number }));

  return {
    ledger: {
      ...ledger,
      status: 'registering',
      registration_results: registrationResults,
    },
    ghCalls,
  };
};

export const registerAndPublish = async ({
  domain,
  ledger,
  outputDirectory,
  scenario,
}) => {
  const registered = applyTriage({ domain, ledger, scenario });
  const { publishRun } = await import('./publication.mjs');
  return publishRun({
    ...registered,
    outputDirectory,
    runId: ledger.run_id,
  });
};
