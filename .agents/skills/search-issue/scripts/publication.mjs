import { linkSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { searchArtifactDigest } from '../../../workflow-contracts/contracts.mjs';
import { assertLedger } from './ledger-contract.mjs';

const safeRunId = /^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9+._-]*$/u;

export const searchArtifact = (runId, selectedIssues) => {
  const identity = {
    version: 2,
    artifact_id: `search:${runId}`,
    search_run_id: runId,
    selected_issues: selectedIssues,
  };
  return {
    version: identity.version,
    artifact_id: identity.artifact_id,
    sha256: searchArtifactDigest(identity),
    search_run_id: identity.search_run_id,
    selected_issues: identity.selected_issues,
  };
};

export const publishJsonExclusive = (target, value) => {
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    linkSync(temporary, target);
  } finally {
    unlinkSync(temporary);
  }
};

export const publishRun = ({ ghCalls, ledger, outputDirectory, runId }) => {
  if (typeof runId !== 'string' || !safeRunId.test(runId)) {
    throw new TypeError('run_id must be a safe artifact basename.');
  }

  assertLedger(ledger);
  const selectedIssues = ledger.registration_results
    .map(({ issue_number: issueNumber }) => issueNumber).filter((number) => number !== null);
  const artifactPath =
    selectedIssues.length === 0
      ? null
      : `.omo/search-issue/artifacts/${runId}.json`;
  const completedLedger = {
    ...ledger,
    status: 'completed',
    handoff:
      artifactPath === null
        ? null
        : {
            artifact_path: artifactPath,
            command: `$create-lane ${artifactPath}`,
          },
  };
  assertLedger(completedLedger);

  publishJsonExclusive(resolve(outputDirectory, 'ledger.json'), completedLedger);
  publishJsonExclusive(resolve(outputDirectory, 'gh-calls.json'), ghCalls);

  if (artifactPath !== null) {
    const artifactTarget = resolve(outputDirectory, artifactPath);
    mkdirSync(resolve(artifactTarget, '..'), { recursive: true });
    publishJsonExclusive(artifactTarget, searchArtifact(runId, selectedIssues));
  }

  return {
    status: 'completed',
    invocation_count: completedLedger.invocations.length,
    registered_issue_count: selectedIssues.length,
  };
};
