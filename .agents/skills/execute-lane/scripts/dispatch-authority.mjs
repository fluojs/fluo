import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { canonicalLaneRuntimeRoot } from './lane-runtime-paths.mjs';

const OPEN = '<fluo-terminal-dispatch-v1>';
const CLOSE = '</fluo-terminal-dispatch-v1>';
const sha256 = /^[a-f0-9]{64}$/u;

export const canonicalPreflightArtifactPath = (repositoryRoot, laneId, issueNumber) =>
  resolve(canonicalLaneRuntimeRoot(repositoryRoot), laneId, 'issues', String(issueNumber), 'review-preflight.json');

export const assertCanonicalPreflightArtifact = ({
  repository_root: repositoryRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  preflight_path: preflightPath,
  preflight_sha256: preflightSha256,
}) => {
  const expected = canonicalPreflightArtifactPath(repositoryRoot, laneId, issueNumber);
  if (preflightPath !== expected || !existsSync(expected)) {
    throw new TypeError('terminal dispatch preflight path is not the canonical immutable artifact.');
  }
  const stat = lstatSync(expected);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(expected) !== expected) {
    throw new TypeError('terminal dispatch preflight artifact must be a canonical regular file.');
  }
  let preflight;
  try {
    preflight = JSON.parse(readFileSync(expected, 'utf8'));
  } catch {
    throw new TypeError('terminal dispatch preflight artifact must contain canonical JSON.');
  }
  if (
    typeof preflight !== 'object' || preflight === null || Array.isArray(preflight) ||
    !sha256.test(preflightSha256 ?? '') || preflight.sha256 !== preflightSha256
  ) {
    throw new TypeError('terminal dispatch preflight digest conflicts with its authoritative artifact.');
  }
  const { sha256: _digest, ...canonical } = preflight;
  if (payloadDigest(canonical) !== preflightSha256) {
    throw new TypeError('terminal dispatch preflight canonical JSON digest is invalid.');
  }
  return preflight;
};

export const terminalDispatchBlock = (payload) =>
  `${OPEN}\n${JSON.stringify(payload)}\n${CLOSE}`;

const occurrences = (source, token) => source.split(token).length - 1;

export const terminalTaskPrompt = ({
  instructions,
  dispatch_block: dispatchBlock,
}) => {
  if (
    typeof instructions !== 'string' ||
    instructions.trim().length === 0 ||
    typeof dispatchBlock !== 'string' ||
    !dispatchBlock.startsWith(`${OPEN}\n`) ||
    !dispatchBlock.endsWith(`\n${CLOSE}`)
  ) {
    throw new TypeError(
      'terminal task prompt requires instructions and a canonical dispatch block.',
    );
  }
  let dispatch;
  try {
    dispatch = JSON.parse(
      dispatchBlock.slice(OPEN.length + 1, -(CLOSE.length + 1)),
    );
  } catch {
    throw new TypeError('terminal task dispatch must be strict JSON.');
  }
  if (
    typeof dispatch !== 'object' ||
    dispatch === null ||
    Array.isArray(dispatch) ||
    typeof dispatch.sentinel !== 'string'
  ) {
    throw new TypeError('terminal task dispatch sentinel is invalid.');
  }
  parseTerminalDispatchShape(dispatchBlock, dispatch.sentinel);
  const prompt = `${instructions.trimEnd()}\n\n${dispatchBlock}`;
  parseTerminalDispatchShape(prompt, dispatch.sentinel);
  return prompt;
};

export const parseTerminalDispatchShape = (prompt, expectedSentinel) => {
  if (typeof prompt !== 'string' || !prompt.endsWith(CLOSE) ||
      occurrences(prompt, OPEN) !== 1 || occurrences(prompt, CLOSE) !== 1) {
    throw new TypeError('task prompt must end with exactly one canonical terminal dispatch block.');
  }
  const start = prompt.lastIndexOf(OPEN);
  const prefix = prompt.slice(0, start);
  const inner = prompt.slice(start + OPEN.length + 1, -(CLOSE.length + 1));
  let dispatch;
  try {
    dispatch = JSON.parse(inner);
  } catch {
    throw new TypeError('terminal task dispatch must be strict JSON.');
  }
  if (
    typeof dispatch !== 'object' || dispatch === null || Array.isArray(dispatch) ||
    JSON.stringify(dispatch) !== inner || dispatch.sentinel !== expectedSentinel ||
    prefix.includes('fluo-terminal-dispatch') ||
    prefix.includes('"preflight_sha256"') ||
    occurrences(prompt, expectedSentinel) !== 1 ||
    (typeof dispatch.preflight_path === 'string' && occurrences(prompt, dispatch.preflight_path) !== 1)
  ) {
    throw new TypeError('task prompt contains duplicate, decoy, or conflicting dispatch authority.');
  }
  return dispatch;
};

export const parseTerminalDispatch = (prompt, expectedSentinel, authority) => {
  const dispatch = parseTerminalDispatchShape(prompt, expectedSentinel);
  assertCanonicalPreflightArtifact({ ...authority, ...dispatch });
  return dispatch;
};
