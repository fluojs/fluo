import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { readIssueSupervisorStore } from './issue-supervisor-store.mjs';
import { issueSupervisorTerminalStatuses } from './issue-supervisor-contracts.mjs';
import {
  canonicalLaneLedgerPath,
  canonicalLaneRuntimeRoot,
} from './lane-runtime-paths.mjs';

const terminalStatuses = new Set(issueSupervisorTerminalStatuses);

export const auditLaneSupervisorSettlement = ({
  repository_root,
  lane,
  command_runner,
}) => {
  assertContract('lane-ledger-v2', lane);
  const runtimeRoot = canonicalLaneRuntimeRoot(repository_root);
  const doneIssues = [];
  const blockedIssues = [];
  const activeIssues = [];
  const missingIssues = [];

  for (const issueNumber of lane.confirmed_issues) {
    const snapshotPath = resolve(
      runtimeRoot,
      lane.lane_id,
      'issues',
      String(issueNumber),
      'snapshot.json',
    );
    if (!existsSync(snapshotPath)) {
      missingIssues.push(issueNumber);
      continue;
    }
    const bundle = readIssueSupervisorStore(
      runtimeRoot,
      lane.lane_id,
      issueNumber,
      { command_runner },
    );
    if (
      bundle.snapshot.lane_id !== lane.lane_id ||
      bundle.snapshot.issue_number !== issueNumber
    ) {
      throw new TypeError(
        `issue store identity does not match lane ${lane.lane_id} issue ${String(issueNumber)}.`,
      );
    }
    const status = bundle.snapshot.status;
    if (status === 'done') {
      doneIssues.push(issueNumber);
    } else if (terminalStatuses.has(status)) {
      blockedIssues.push({ issue_number: issueNumber, status });
    } else {
      activeIssues.push({ issue_number: issueNumber, status });
    }
  }

  return {
    version: 1,
    lane_id: lane.lane_id,
    status:
      activeIssues.length === 0 && missingIssues.length === 0
        ? 'terminal-claims-ready'
        : 'incomplete',
    done_issues: doneIssues,
    blocked_issues: blockedIssues,
    active_issues: activeIssues,
    missing_issues: missingIssues,
  };
};

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new TypeError(`Missing ${flag}.`);
  }
  return value;
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      'Usage: node lane-settlement-audit.mjs --root <repository> --ledger <lane-ledger>\n',
    );
    process.exit(0);
  }
  const canonical = canonicalLaneLedgerPath(
    valueAfter(args, '--root'),
    valueAfter(args, '--ledger'),
  );
  const lane = JSON.parse(readFileSync(canonical.ledgerPath, 'utf8'));
  if (lane.lane_id !== canonical.laneId) {
    throw new TypeError(
      'lane ledger identity does not match its canonical path.',
    );
  }
  const result = auditLaneSupervisorSettlement({
    repository_root: canonical.repositoryRoot,
    lane,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'terminal-claims-ready') {
    process.exitCode = 1;
  }
}
