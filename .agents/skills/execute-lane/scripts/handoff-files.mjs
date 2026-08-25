import {
  existsSync,
  lstatSync,
  readFileSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

import { assertHandoffProvenance } from './handoff-provenance.mjs';
import { assertReleaseHandoffBinding } from './release-handoff-approval.mjs';

const approvalStages = [
  'confirmed-issues',
  'suggested-additions',
  'lane-plan',
];

const assertRegularFile = (path) => {
  if (!existsSync(path)) {
    throw new TypeError(`${path} must exist.`);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new TypeError(`${path} must be a real regular file.`);
  }
};

const assertRealDirectory = (path) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`${path} must be a real directory.`);
  }
};

const readJson = (path) => {
  assertRegularFile(path);
  return JSON.parse(readFileSync(path, 'utf8'));
};

const assertContainedPaths = (repositoryRoot, paths) => {
  for (const path of paths) {
    const pathFromRoot = relative(repositoryRoot, path);
    if (
      pathFromRoot.startsWith('..') ||
      resolve(repositoryRoot, pathFromRoot) !== path
    ) {
      throw new TypeError('lane handoff evidence escaped the repository root');
    }
  }
};

const evidencePaths = (repositoryRoot, ledger) => {
  const omoDirectory = resolve(repositoryRoot, '.omo');
  const approvalDirectory = resolve(omoDirectory, 'approvals');
  const searchDirectory = resolve(omoDirectory, 'search-issue');
  const artifactDirectory = resolve(searchDirectory, 'artifacts');
  for (const directory of [
    repositoryRoot,
    omoDirectory,
    approvalDirectory,
    searchDirectory,
    artifactDirectory,
  ]) {
    assertRealDirectory(directory);
  }
  if (ledger.source.search_ledger.includes('/legacy/')) {
    assertRealDirectory(resolve(artifactDirectory, 'legacy'));
  }
  return {
    artifactPath: resolve(repositoryRoot, ledger.source.search_ledger),
    approvalPaths: approvalStages.map((stage) =>
      resolve(
        approvalDirectory,
        `approval-${ledger.lane_id}-${stage}.json`,
      ),
    ),
  };
};

export const loadCanonicalHandoffContext = (
  repositoryRoot,
  ledgerPath,
  canonicalLedger,
) => {
  const laneDirectory = resolve(repositoryRoot, '.omo/lanes');
  assertRealDirectory(laneDirectory);
  const expectedLedgerPath = resolve(
    laneDirectory,
    `${canonicalLedger.lane_id}.json`,
  );
  if (resolve(ledgerPath) !== expectedLedgerPath) {
    throw new TypeError(
      'execute-lane requires the canonical lane path',
    );
  }
  const { artifactPath, approvalPaths } = evidencePaths(
    repositoryRoot,
    canonicalLedger,
  );
  assertContainedPaths(repositoryRoot, [
    expectedLedgerPath,
    artifactPath,
    ...approvalPaths,
  ]);
  const artifact = readJson(artifactPath);
  const approvalReceipts = approvalPaths.map(readJson);
  assertHandoffProvenance({
    ledger: canonicalLedger,
    receipts: approvalReceipts,
    artifact,
    artifactPath: canonicalLedger.source.search_ledger,
  });
  if (canonicalLedger.release_handoffs.length > 0) {
    assertReleaseHandoffBinding(
      canonicalLedger,
      approvalReceipts[2],
      artifact,
      canonicalLedger.source.search_ledger,
    );
  }
  return {
    artifact,
    artifactPath: canonicalLedger.source.search_ledger,
    approvalReceipts,
    canonicalLedger,
  };
};

export const loadFixtureHandoffContext = (
  repositoryRoot,
  ledger,
  canonicalLedger,
) => {
  const canonicalRequiresApproval =
    canonicalLedger.release_handoffs.length > 0 ||
    canonicalLedger.lane_plan_approval_sha256 !== undefined;
  const snapshotRequiresApproval =
    ledger.release_handoffs.length > 0 ||
    ledger.lane_plan_approval_sha256 !== undefined;
  if (!canonicalRequiresApproval && !snapshotRequiresApproval) {
    return null;
  }
  if (
    canonicalRequiresApproval &&
    ledger.lane_plan_approval_sha256 !==
      canonicalLedger.lane_plan_approval_sha256
  ) {
    throw new TypeError(
      'persisted lane-plan approval binding does not match the canonical ledger',
    );
  }
  const evidenceLedger = canonicalRequiresApproval
    ? canonicalLedger
    : ledger;
  const { artifactPath, approvalPaths } = evidencePaths(
    repositoryRoot,
    evidenceLedger,
  );
  const lanePlanPath = approvalPaths[2];
  assertContainedPaths(repositoryRoot, [lanePlanPath, artifactPath]);
  if (!existsSync(lanePlanPath)) {
    throw new TypeError(
      'release handoffs require their consumed lane-plan approval receipt',
    );
  }
  const receipt = readJson(lanePlanPath);
  const artifact = readJson(artifactPath);
  assertReleaseHandoffBinding(
    ledger,
    receipt,
    artifact,
    evidenceLedger.source.search_ledger,
  );
  return {
    receipt,
    artifact,
    artifactPath: evidenceLedger.source.search_ledger,
  };
};
