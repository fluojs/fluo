import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import { publishSearchArtifact } from '../../../search-issue/scripts/publish-search-artifact.mjs';
import { prepareScenario } from '../contracts.mjs';

class UnsafeOutputPathError extends TypeError {}

const args = process.argv.slice(2);
if (!args.includes('--fixture-only')) {
  throw new TypeError(
    'run-scenario.mjs is a fixture-only contract exerciser; production approvals come from the trusted lead.',
  );
}
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) {
    throw new TypeError(`Missing ${flag}.`);
  }
  return value;
};

const ensureDirectory = (path) => {
  if (!existsSync(path)) {
    mkdirSync(path);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new UnsafeOutputPathError(`${path} must be a real directory.`);
  }
};

const ensureOutputDirectories = (outputRoot) => {
  ensureDirectory(outputRoot);
  const omoDirectory = resolve(outputRoot, '.omo');
  const laneDirectory = resolve(omoDirectory, 'lanes');
  const approvalDirectory = resolve(omoDirectory, 'approvals');
  ensureDirectory(omoDirectory);
  ensureDirectory(laneDirectory);
  ensureDirectory(approvalDirectory);
  return { laneDirectory, approvalDirectory };
};

const writeCandidate = (directory, name, value) => {
  const path = resolve(directory, `.${name}.${randomUUID()}.tmp`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return path;
};

const safeUnlink = (path) => {
  if (existsSync(path)) {
    unlinkSync(path);
  }
};

const publishReadyLane = (outputRoot, prepared) => {
  let directories;
  try {
    directories = ensureOutputDirectories(outputRoot);
  } catch (error) {
    if (error instanceof UnsafeOutputPathError) {
      return { status: 'rejected', reason: 'unsafe_output_path' };
    }
    throw error;
  }

  const relativeTarget = `.omo/lanes/${prepared.ledger.lane_id}.json`;
  const target = resolve(outputRoot, relativeTarget);
  const ledgerCandidate = writeCandidate(
    directories.laneDirectory,
    prepared.ledger.lane_id,
    prepared.ledger,
  );
  const approvalCandidates = prepared.approvals.map((approval) => ({
    candidate: writeCandidate(
      directories.approvalDirectory,
      approval.approval_id,
      {
        version: 1,
        approval_id: approval.approval_id,
        gate: approval.gate,
        binding_sha256: approval.binding_sha256,
        lane_id: prepared.ledger.lane_id,
        ...(approval.gate === 'lane-plan'
          ? {
              release_handoff_attestations:
                approval.release_handoff_attestations,
              plan: prepared.plan,
            }
          : { issue_numbers: approval.issue_numbers }),
      },
    ),
    target: resolve(
      directories.approvalDirectory,
      `${approval.approval_id}.json`,
    ),
  }));
  const linkedApprovals = [];
  let published = false;

  try {
    for (const approval of approvalCandidates) {
      try {
        linkSync(approval.candidate, approval.target);
        linkedApprovals.push(approval.target);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
          return { status: 'rejected', reason: 'approval_replayed' };
        }
        throw error;
      }
    }
    try {
      linkSync(ledgerCandidate, target);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        return { status: 'rejected', reason: 'target_collision' };
      }
      throw error;
    }
    published = true;
    return { status: 'ready', ledger: relativeTarget };
  } finally {
    if (!published) {
      for (const approvalTarget of linkedApprovals) {
        safeUnlink(approvalTarget);
      }
    }
    safeUnlink(ledgerCandidate);
    for (const approval of approvalCandidates) {
      safeUnlink(approval.candidate);
    }
  }
};

const prepared = prepareScenario(valueAfter('--scenario'));
const outputRoot = resolve(valueAfter('--out'));
let result;
if (prepared.kind === 'rejected') {
  result = prepared.result;
} else {
  if (prepared.publishArtifact) {
    try {
      const published = publishSearchArtifact({
        repositoryRoot: outputRoot,
        runId: prepared.artifact.search_run_id,
        issueNumbers: prepared.artifact.selected_issues,
      });
      if (
        published.artifact_path !== prepared.artifactPath ||
        JSON.stringify(published.artifact) !==
          JSON.stringify(prepared.artifact)
      ) {
        throw new TypeError(
          'Published artifact does not match normalized intake.',
        );
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        result = { status: 'rejected', reason: 'artifact_collision' };
      } else if (
        error instanceof TypeError &&
        /symbolic-link|symlink/u.test(error.message)
      ) {
        result = { status: 'rejected', reason: 'unsafe_output_path' };
      } else {
        throw error;
      }
    }
  }
  result ??= publishReadyLane(outputRoot, prepared);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
