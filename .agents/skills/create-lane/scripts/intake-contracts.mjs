import { basename } from 'node:path';

import { searchArtifact } from '../../search-issue/scripts/publication.mjs';

const artifactPattern =
  /^\.omo\/search-issue\/artifacts\/(?:legacy\/)?([A-Za-z0-9][A-Za-z0-9+._-]*)\.json$/u;
const safeRunId = /^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9+._-]*$/u;

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (record, keys) => {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const isIssueArray = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((issue) => Number.isSafeInteger(issue) && issue > 0) &&
  new Set(value).size === value.length;

const generatedIntake = (runId, issueNumbers) => ({
  artifact: searchArtifact(runId, issueNumbers),
  artifactPath: `.omo/search-issue/artifacts/${runId}.json`,
  publishArtifact: true,
});

export const normalizeIntake = (scenario) => {
  const intake = scenario.intake;
  if (!isRecord(intake) || typeof intake.mode !== 'string') {
    return { reason: 'mixed_input' };
  }
  if (
    intake.mode === 'artifact' &&
    hasExactKeys(intake, ['mode', 'artifact_path'])
  ) {
    const match =
      typeof intake.artifact_path === 'string'
        ? artifactPattern.exec(intake.artifact_path)
        : null;
    if (match === null) {
      return { reason: 'mixed_input' };
    }
    const artifact =
      isRecord(scenario.artifacts) &&
      Object.hasOwn(scenario.artifacts, intake.artifact_path)
        ? scenario.artifacts[intake.artifact_path]
        : undefined;
    if (
      !isRecord(artifact) ||
      `${match[1]}.json` !== basename(intake.artifact_path) ||
      match[1] !== artifact.search_run_id
    ) {
      return { reason: 'invalid_artifact' };
    }
    return {
      artifact,
      artifactPath: intake.artifact_path,
      publishArtifact: false,
    };
  }
  if (
    intake.mode === 'issue-numbers' &&
    hasExactKeys(intake, ['mode', 'issue_numbers', 'search_run_id'])
  ) {
    if (
      !isIssueArray(intake.issue_numbers) ||
      typeof intake.search_run_id !== 'string' ||
      !safeRunId.test(intake.search_run_id)
    ) {
      return { reason: 'invalid_issue_numbers' };
    }
    return generatedIntake(intake.search_run_id, intake.issue_numbers);
  }
  if (
    intake.mode === 'verbal' &&
    hasExactKeys(intake, [
      'mode',
      'query',
      'resolved_issue_numbers',
      'search_run_id',
    ])
  ) {
    if (
      typeof intake.query !== 'string' ||
      intake.query.trim().length === 0 ||
      !isIssueArray(intake.resolved_issue_numbers) ||
      typeof intake.search_run_id !== 'string' ||
      !safeRunId.test(intake.search_run_id)
    ) {
      return { reason: 'unresolved_verbal_input' };
    }
    return generatedIntake(
      intake.search_run_id,
      intake.resolved_issue_numbers,
    );
  }
  return { reason: 'mixed_input' };
};
