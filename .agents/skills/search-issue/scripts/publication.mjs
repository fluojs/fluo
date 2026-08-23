import { linkSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const safeRunId = /^[a-z0-9][a-z0-9-]{0,127}$/;

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
    throw new TypeError('run_id must be a safe lowercase identifier.');
  }

  const selectedIssues = ghCalls.map(({ issue_number: issueNumber }) => issueNumber);
  const artifactPath =
    selectedIssues.length === 0
      ? null
      : `.omo/search-issue/${runId}.json`;
  const completedLedger = {
    ...ledger,
    status: 'completed',
    handoff:
      artifactPath === null
        ? null
        : {
            artifact_path: artifactPath,
            command: `$create-lane ${artifactPath} main`,
          },
  };

  publishJsonExclusive(resolve(outputDirectory, 'ledger.json'), completedLedger);
  publishJsonExclusive(resolve(outputDirectory, 'gh-calls.json'), ghCalls);

  if (artifactPath !== null) {
    publishJsonExclusive(resolve(outputDirectory, 'search-artifact.json'), {
      version: 1,
      search_run_id: runId,
      selected_issues: selectedIssues,
    });
  }

  return {
    status: 'completed',
    invocation_count: completedLedger.invocations.length,
    registered_issue_count: selectedIssues.length,
  };
};
