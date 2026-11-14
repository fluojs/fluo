import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { schemaFailure } from '../../../workflow-contracts/schema-validator.mjs';
import { prepareRun } from './contracts.mjs';
import { draftState } from './drafts.mjs';

const load = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, '../references', name), 'utf8'));
const schema = load('run-ledger.schema.json');
const reviewerSchema = load('reviewer-contract.schema.json');
export const domain = load('domain.json');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const identityDigest = (ledger) => digest({
  run_id: ledger.run_id, repository: ledger.repository,
  intake: ledger.intake, authority: ledger.authority,
});
export const registrationMarker = (ledger, draft) =>
  `<!-- fluo-search:${digest({ repository: ledger.repository, run_id: ledger.run_id, draft })} -->`;

export const assertReviewerResult = (result, invocation) => {
  const failure = schemaFailure(reviewerSchema, result, 'reviewer');
  if (failure !== null) throw new TypeError(failure);
  if (result.invocation_id !== invocation.invocation_id ||
      result.package !== invocation.package || result.reviewer !== invocation.reviewer ||
      result.result_type !== invocation.expected_result_type) {
    throw new TypeError('Reviewer invocation identity mismatch.');
  }
  for (const record of result.records) {
    if (result.result_type === 'audit_finding' &&
        (!['P0', 'P1', 'P2'].includes(record.severity) ||
         typeof record.problem !== 'string' || !record.problem.trim() ||
         !Array.isArray(record.evidence) || record.evidence.length === 0 ||
         record.evidence.some((path) => typeof path !== 'string' || !/:\d+$/u.test(path)) ||
         typeof record.contract_impact !== 'string' ||
         !Array.isArray(record.affected_surfaces))) {
      throw new TypeError('Malformed audit finding.');
    }
    if (result.result_type === 'rd_brief' &&
        (typeof record.user_problem !== 'string' || !record.user_problem.trim() ||
         !Array.isArray(record.evidence_basis) || record.evidence_basis.length === 0 ||
         !['register', 'defer', 'reject'].includes(record.issue_eligibility))) {
      throw new TypeError('Malformed R&D brief.');
    }
  }
};

export const assertTriage = (ledger, catalog = domain) => {
  if (ledger.registration_triage.length !== ledger.drafts.length ||
      new Set(ledger.registration_triage.map((decision) => decision.draft_id)).size !== ledger.drafts.length) {
    throw new TypeError('Every draft requires exactly one triage decision.');
  }
  return ledger.registration_triage.map((decision) => {
    const draft = ledger.drafts.find((item) => item.draft_id === decision.draft_id);
    if (!draft || !['register', 'defer', 'reject'].includes(decision.decision) ||
        !Array.isArray(decision.labels) || decision.labels.some((label) => !catalog.labels.includes(label))) {
      throw new TypeError(`Invalid triage decision or labels: ${decision.draft_id}.`);
    }
    if (decision.decision === 'register') {
      if (draft.labels.filter((label) => label.startsWith('area:') || label.startsWith('pkg:'))
          .some((label) => !decision.labels.includes(label))) {
        throw new TypeError(`Missing package labels for ${decision.draft_id}.`);
      }
      if (decision.labels.filter((label) => label.startsWith('area:') || label.startsWith('pkg:'))
          .some((label) => !draft.labels.includes(label))) {
        throw new TypeError(`Unexpected package labels for ${decision.draft_id}.`);
      }
      const priority = draft.labels.find((label) => label.startsWith('priority:'));
      if (decision.safety_route !== 'public-issue' || !['high', 'medium'].includes(decision.confidence) ||
          decision.duplicate_of !== null || !decision.labels.includes(priority) ||
          decision.labels.filter((label) => label.startsWith('priority:')).length !== 1 ||
          !decision.labels.includes('source:package-audit') ||
          !decision.labels.some((label) =>
            ['bug', 'enhancement', 'documentation', 'performance', 'tech-debt', 'type:maintainability'].includes(label)) ||
          decision.labels.includes('scope:security')) {
        throw new TypeError(`Unsafe registration decision: ${decision.draft_id}.`);
      }
    }
    return { decision, draft };
  });
};

export const assertLedger = (ledger) => {
  const failure = schemaFailure(schema, ledger, 'ledger');
  if (failure !== null) throw new TypeError(failure);
  if (identityDigest(ledger) !== ledger.identity_sha256) throw new TypeError('Immutable intake changed.');
  const prepared = prepareRun({ intake: { ...ledger.intake, scope_mode: ledger.intake.mode } });
  if (prepared.kind !== 'ready' || !equal(prepared.scope, ledger.intake) ||
      prepared.invocations.length !== ledger.invocations.length) throw new TypeError('Invalid immutable scope.');
  const taskIds = ledger.invocations.map((invocation) => invocation.task_id).filter((id) => id !== null);
  if (new Set(taskIds).size !== taskIds.length) throw new TypeError('Duplicate native task ID.');
  for (const [index, invocation] of ledger.invocations.entries()) {
    const expected = prepared.invocations[index];
    for (const key of ['invocation_id', 'package', 'reviewer', 'expected_result_type']) {
      if (invocation[key] !== expected[key]) throw new TypeError('Invocation scope mismatch.');
    }
    if ((invocation.status === 'expected' && (invocation.task_id !== null || invocation.result !== null)) ||
        (invocation.status !== 'expected' && invocation.task_id === null) ||
        (invocation.status === 'started' && invocation.result !== null)) {
      throw new TypeError('Invocation lacks native lifecycle evidence.');
    }
    if (invocation.result !== null) {
      assertReviewerResult(invocation.result, invocation);
      if ((invocation.status === 'completed') !== (invocation.result.status === 'completed')) {
        throw new TypeError('Invocation terminal status mismatch.');
      }
    } else if (invocation.status === 'completed') throw new TypeError('Completed invocation lacks result.');
  }
  const allCompleted = ledger.invocations.every((invocation) => invocation.status === 'completed');
  if ((!allCompleted && ['triage', 'registering', 'published', 'completed'].includes(ledger.status)) ||
      (!allCompleted && [ledger.findings, ledger.rd_briefs, ledger.drafts,
        ledger.registration_triage, ledger.registration_results].some((items) => items.length !== 0))) {
    throw new TypeError('Incomplete reviewer wave.');
  }
  if (allCompleted && (['triage', 'registering', 'published', 'completed'].includes(ledger.status) ||
      [ledger.findings, ledger.rd_briefs, ledger.drafts].some((items) => items.length !== 0))) {
    const state = draftState(ledger, domain);
    for (const key of ['findings', 'rd_briefs', 'drafts']) {
      if (!equal(state[key], ledger[key])) throw new TypeError(`Invalid derived ${key}.`);
    }
  }
  if (ledger.registration_triage.length !== 0 || ['registering', 'published', 'completed'].includes(ledger.status)) {
    assertTriage(ledger);
  }
  const receiptIds = new Set();
  for (const receipt of ledger.registration_results) {
    const draft = ledger.drafts.find((item) => item.draft_id === receipt.draft_id);
    const decision = ledger.registration_triage.find((item) => item.draft_id === receipt.draft_id);
    if (!draft || !decision || receiptIds.has(receipt.draft_id) || receipt.decision !== decision.decision) {
      throw new TypeError('Invalid registration receipt identity.');
    }
    receiptIds.add(receipt.draft_id);
    if (receipt.issue_number !== null) {
      if (receipt.decision !== 'register' || !ledger.authority.explicit_harness_invocation ||
          ledger.authority.investigation_only ||
          receipt.issue_url !== `https://github.com/${ledger.repository}/issues/${receipt.issue_number}` ||
          receipt.marker !== registrationMarker(ledger, draft)) throw new TypeError('Invalid creation receipt.');
    } else if (receipt.issue_url !== null || receipt.marker !== null ||
        (decision.decision === 'register' && ledger.authority.explicit_harness_invocation &&
         !ledger.authority.investigation_only)) throw new TypeError('Missing creation receipt.');
  }
  const numbers = ledger.registration_results.map((receipt) => receipt.issue_number).filter((n) => n !== null);
  if (new Set(numbers).size !== numbers.length) throw new TypeError('Duplicate issue receipt.');
  if (['published', 'completed'].includes(ledger.status) &&
      ledger.registration_results.length !== ledger.drafts.length) throw new TypeError('Incomplete registration.');
  const path = `.omo/search-issue/artifacts/${ledger.run_id}.json`;
  if (ledger.handoff !== null && (!numbers.length ||
      !equal(ledger.handoff, { artifact_path: path, command: `$create-lane ${path}` }))) {
    throw new TypeError('Invalid publication handoff.');
  }
  if (ledger.status === 'completed' && (numbers.length > 0) !== (ledger.handoff !== null)) {
    throw new TypeError('Missing publication handoff.');
  }
  if ((ledger.status === 'blocked') !== (ledger.blocked_reason !== null)) throw new TypeError('Invalid blocked reason.');
  return ledger;
};
