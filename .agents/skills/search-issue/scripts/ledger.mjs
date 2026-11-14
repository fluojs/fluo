import { prepareRun } from './contracts.mjs';
import { draftState } from './drafts.mjs';
import { assertLedger, assertReviewerResult, identityDigest } from './ledger-contract.mjs';

export const createLedger = (prepared) => {
  const ledger = {
    version: 1, run_id: prepared.scenario.run_id,
    repository: prepared.scenario.repository,
    identity_sha256: '', status: 'running',
    intake: prepared.scope, authority: prepared.scenario.authority,
    invocations: prepared.invocations.map((invocation) => ({
      ...invocation, task_id: null, result: null,
    })),
    findings: [], rd_briefs: [], drafts: [], registration_triage: [],
    registration_results: [], handoff: null, blocked_reason: null,
  };
  ledger.identity_sha256 = identityDigest(ledger);
  return assertLedger(ledger);
};

export const startInvocation = (ledger, invocationId, taskId) => {
  assertLedger(ledger);
  if (ledger.status !== 'running' || typeof taskId !== 'string' || !taskId.trim()) {
    throw new TypeError('Starting requires a running ledger and native task ID.');
  }
  const invocation = ledger.invocations.find((item) => item.invocation_id === invocationId);
  if (!invocation || invocation.status !== 'expected') throw new TypeError('Invocation is not expected.');
  return assertLedger({
    ...ledger, invocations: ledger.invocations.map((item) =>
      item === invocation ? { ...item, status: 'started', task_id: taskId } : item),
  });
};

export const collectResult = (ledger, result) => {
  assertLedger(ledger);
  const invocation = ledger.invocations.find((item) => item.invocation_id === result?.invocation_id);
  if (ledger.status !== 'running' || !invocation || invocation.status !== 'started') {
    throw new TypeError('Result requires one started native invocation.');
  }
  assertReviewerResult(result, invocation);
  return assertLedger({
    ...ledger,
    status: result.status === 'completed' ? 'running' : 'blocked',
    blocked_reason: result.status === 'completed' ? null : result.stop_reason,
    invocations: ledger.invocations.map((item) => item === invocation
      ? { ...item, result, status: result.status } : item),
  });
};

export const createDrafts = (ledger, domain) => {
  assertLedger(ledger);
  if (ledger.status !== 'running' || ledger.invocations.some((item) => item.status !== 'completed')) {
    throw new TypeError('Every native invocation must complete before drafting.');
  }
  return assertLedger({ ...ledger, status: 'triage', ...draftState(ledger, domain) });
};

// Fixture adaptation stops here. Construction, collection, drafts, validation and
// registration below use exactly the production state transitions.
export const buildLedger = (prepared) => {
  const scenario = {
    ...prepared.scenario,
    repository: prepared.scenario.repository ?? 'fluojs/fluo',
  };
  const normalized = prepareRun(scenario);
  if (normalized.kind !== 'ready') throw new TypeError('Invalid fixture intake.');
  let ledger = createLedger(normalized);
  for (const [index, result] of scenario.reviewer_results.entries()) {
    ledger = startInvocation(ledger, result.invocation_id, `fixture-${index}`);
    ledger = collectResult(ledger, {
      contract_version: 1, stop_reason: 'fixture',
      verification: { checked_paths: [], evidence_complete: true }, ...result,
    });
  }
  ledger = createDrafts(ledger, prepared.domain);
  return assertLedger({ ...ledger, registration_triage: scenario.registration_triage });
};

export const runReadyScenario = async (prepared, outputDirectory) => {
  const ledger = buildLedger(prepared);
  const { registerAndPublish } = await import('./registration.mjs');
  return registerAndPublish({
    domain: prepared.domain, ledger, outputDirectory, scenario: prepared.scenario,
  });
};
