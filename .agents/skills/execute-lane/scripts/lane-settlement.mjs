import { resolve } from 'node:path';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { terminalizeBlockedDependents } from './dependency-gate.mjs';
import { acquireLease } from './lane-lease.mjs';
import {
  canonicalLaneLedgerPath,
  canonicalLaneRuntimeRoot,
} from './lane-runtime-paths.mjs';
import { loadState, persistState } from './state-store.mjs';
import { importSupervisorTerminal } from './supervisor-terminal.mjs';

const issueNumberFor = (transport) => {
  const issueNumber = transport?.snapshot?.issue_number;
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new TypeError(
      'settlement supervisor transport requires a positive issue number.',
    );
  }
  return issueNumber;
};

const orderedIssues = (snapshot, issues) => {
  const selected = new Set(issues);
  const dependencies = new Map(
    issues.map((issueNumber) => [issueNumber, new Set()]),
  );
  for (const issueNumber of issues) {
    for (
      const dependency of snapshot.dependency_graph[
        String(issueNumber)
      ] ?? []
    ) {
      if (selected.has(dependency)) {
        dependencies.get(issueNumber).add(dependency);
      }
    }
  }
  for (const lane of snapshot.lanes) {
    for (let index = 1; index < lane.queue.length; index += 1) {
      const issueNumber = lane.queue[index];
      const predecessor = lane.queue[index - 1];
      if (selected.has(issueNumber) && selected.has(predecessor)) {
        dependencies.get(issueNumber).add(predecessor);
      }
    }
  }
  const ordered = [];
  const remaining = new Set(issues);
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((issueNumber) =>
        [...dependencies.get(issueNumber)].every(
          (dependency) => !remaining.has(dependency),
        ),
      )
      .sort((left, right) => left - right);
    if (ready.length === 0) {
      throw new TypeError(
        'settlement supervisor transports contain a dependency cycle.',
      );
    }
    for (const issueNumber of ready) {
      ordered.push(issueNumber);
      remaining.delete(issueNumber);
    }
  }
  return ordered;
};

const persistIfChanged = (previous, next, persistTransition) => {
  if (payloadDigest(previous) !== payloadDigest(next)) {
    persistTransition(previous, next);
  }
  return next;
};

export const settleLaneSupervisorTransports = ({
  persisted,
  repository_root: repositoryRoot,
  supervisor_transports: supervisorTransports,
  artifact_observations: artifactObservations,
  live_completions: liveCompletions = {},
  release_handoff_contexts: releaseHandoffContexts = {},
  command_runner: commandRunner,
  import_terminal: importTerminal = importSupervisorTerminal,
  terminalize_dependents: terminalizeDependents =
    terminalizeBlockedDependents,
  persist_transition: persistTransition = () => {},
}) => {
  if (
    typeof repositoryRoot !== 'string' ||
    !Array.isArray(supervisorTransports) ||
    !Array.isArray(artifactObservations)
  ) {
    throw new TypeError('lane settlement inputs are invalid.');
  }
  const transportsByIssue = new Map();
  for (const transport of supervisorTransports) {
    const issueNumber = issueNumberFor(transport);
    if (transportsByIssue.has(issueNumber)) {
      throw new TypeError(
        `duplicate supervisor terminal transport for issue ${String(issueNumber)}.`,
      );
    }
    transportsByIssue.set(issueNumber, transport);
  }
  let current = persisted;
  for (const issueNumber of orderedIssues(
    current.snapshot,
    [...transportsByIssue.keys()],
  )) {
    const next = importTerminal(
      current,
      transportsByIssue.get(issueNumber),
      liveCompletions[String(issueNumber)] ?? null,
      releaseHandoffContexts[String(issueNumber)] ?? null,
      {
        repository_root: repositoryRoot,
        command_runner: commandRunner,
      },
    );
    current = persistIfChanged(current, next, persistTransition);
  }
  const withDependents = terminalizeDependents(current, artifactObservations);
  return persistIfChanged(current, withDependents, persistTransition);
};

export const settleLaneRuntime = ({
  repository_root: repositoryRoot,
  ledger_path: ledgerPath,
  supervisor_transports: supervisorTransports,
  artifact_observations: artifactObservations,
  live_completions: liveCompletions,
  release_handoff_contexts: releaseHandoffContexts,
  command_runner: commandRunner,
}) => {
  const canonical = canonicalLaneLedgerPath(repositoryRoot, ledgerPath);
  const stateDirectory = resolve(
    canonicalLaneRuntimeRoot(canonical.repositoryRoot),
    canonical.laneId,
  );
  const lease = acquireLease(stateDirectory, canonical.laneId);
  try {
    const persisted = loadState(
      stateDirectory,
      canonical.ledgerPath,
      canonical.repositoryRoot,
    );
    const settled = settleLaneSupervisorTransports({
      persisted,
      repository_root: canonical.repositoryRoot,
      supervisor_transports: supervisorTransports,
      artifact_observations: artifactObservations,
      live_completions: liveCompletions,
      release_handoff_contexts: releaseHandoffContexts,
      command_runner: commandRunner,
      persist_transition: (previous, next) =>
        persistState(stateDirectory, previous, next),
    });
    lease.release('settled');
    return settled;
  } catch (error) {
    lease.release('failed');
    throw error;
  }
};
