import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const contractNames = [
  'search-artifact-v2',
  'lane-ledger-v2',
  'review-verdict',
  'blocker',
  'receipt',
  'event',
];

const schemas = new Map(
  contractNames.map((name) => [
    name,
    JSON.parse(readFileSync(resolve(import.meta.dirname, `${name}.schema.json`), 'utf8')),
  ]),
);

export class WorkflowContractError extends TypeError {
  constructor(contractPath, reason) {
    super(`${contractPath}: ${reason}`);
    this.name = 'WorkflowContractError';
    this.contractPath = contractPath;
    this.reason = reason;
  }
}

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const valueTypeMatches = (type, value) => {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isSafeInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
};

const schemaFailure = (schema, value, path) => {
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter((candidate) => schemaFailure(candidate, value, path) === null);
    return matches.length === 1 ? null : `${path} must match exactly one variant`;
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    return `${path} must equal ${JSON.stringify(schema.const)}`;
  }
  if (schema.enum !== undefined && !schema.enum.some((item) => Object.is(item, value))) {
    return `${path} must be one of ${schema.enum.join(', ')}`;
  }
  if (schema.type !== undefined && !valueTypeMatches(schema.type, value)) {
    return `${path} must be ${schema.type}`;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${path} must not be empty`;
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      return `${path} does not match its canonical pattern`;
    }
  }
  if (Number.isSafeInteger(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `${path} is below its minimum`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `${path} is above its maximum`;
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${path} must contain at least ${String(schema.minItems)} item(s)`;
    }
    if (schema.uniqueItems === true) {
      const encoded = value.map((item) => JSON.stringify(item));
      if (new Set(encoded).size !== encoded.length) {
        return `${path} must contain unique items`;
      }
    }
    if (schema.items !== undefined) {
      for (const [index, item] of value.entries()) {
        const failure = schemaFailure(schema.items, item, `${path}[${String(index)}]`);
        if (failure !== null) {
          return failure;
        }
      }
    }
  }
  if (isRecord(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        return `${path}.${key} is required`;
      }
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      const unknownKey = Object.keys(value).find((key) => !Object.hasOwn(properties, key));
      if (unknownKey !== undefined) {
        return `${path} has unknown key ${unknownKey}`;
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        const failure = schemaFailure(propertySchema, value[key], `${path}.${key}`);
        if (failure !== null) {
          return failure;
        }
      }
    }
  }
  return null;
};

const fail = (path, reason) => {
  throw new WorkflowContractError(path, reason);
};

const assertSafeBranch = (branch) => {
  const safe =
    branch !== 'HEAD' &&
    !branch.startsWith('refs/') &&
    !branch.includes('..') &&
    !branch.includes('@{') &&
    branch.split('/').every(
      (part) =>
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part) &&
        !part.endsWith('.') &&
        !part.endsWith('.lock'),
    );
  if (!safe) {
    fail('lane-ledger-v2.branch', 'branch must be a safe canonical branch');
  }
};

const assertSemanticContract = (name, value) => {
  switch (name) {
    case 'search-artifact-v2':
      if (value.artifact_id !== `search:${value.search_run_id}`) {
        fail(name, 'artifact_id must be canonically derived from search_run_id');
      }
      return;
    case 'lane-ledger-v2':
      assertSafeBranch(value.branch);
      if (value.worktree !== `.worktrees/${value.branch}`) {
        fail(name, 'worktree must exactly match branch under .worktrees');
      }
      return;
    case 'review-verdict':
      if (value.verdict === 'pass' && value.blockers.length !== 0) {
        fail(name, 'pass verdict must not contain blockers');
      }
      if (value.verdict === 'block' && value.blockers.length === 0) {
        fail(name, 'block verdict must contain at least one blocker');
      }
      return;
    case 'receipt':
      if (value.status === 'succeeded' && value.head_sha === null) {
        fail(name, 'succeeded receipt must bind head_sha');
      }
      return;
    case 'event': {
      const timestamp = new Date(value.occurred_at);
      if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value.occurred_at) {
        fail(name, 'occurred_at must be a canonical UTC timestamp');
      }
      if (value.event_hash !== hashEvent(value)) {
        fail(name, 'event_hash does not match the canonical event content');
      }
      return;
    }
    case 'blocker':
      return;
    default:
      fail(name, 'unknown contract');
  }
};

export const assertContract = (name, value) => {
  const schema = schemas.get(name);
  if (schema === undefined) {
    fail(name, 'unknown contract');
  }
  const failure = schemaFailure(schema, value, name);
  if (failure !== null) {
    fail(name, failure);
  }
  assertSemanticContract(name, value);
};

export const assertLaneSourceBinding = (lane, artifact) => {
  assertContract('lane-ledger-v2', lane);
  assertContract('search-artifact-v2', artifact);
  if (lane.source.artifact_id !== artifact.artifact_id || lane.source.sha256 !== artifact.sha256) {
    fail('lane-ledger-v2.source', 'source binding must match artifact_id and sha256');
  }
};

export const assertSameHeadReview = (verdict, lane) => {
  assertContract('review-verdict', verdict);
  assertContract('lane-ledger-v2', lane);
  if (
    verdict.lane_id !== lane.lane_id || verdict.issue_number !== lane.issue_number || verdict.head_sha !== lane.head_sha
  ) {
    fail('review-verdict', 'review must bind the same head and lane identity');
  }
};

export const hashEvent = (event) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        event.version,
        event.stream_id,
        event.sequence,
        event.previous_hash,
        event.event_type,
        event.subject_id,
        event.payload_sha256,
        event.occurred_at,
      ]),
    )
    .digest('hex');

export const assertEventChain = (events) => {
  if (!Array.isArray(events) || events.length === 0) {
    fail('event-chain', 'events must be a non-empty array');
  }
  let previousHash = null;
  let streamId;
  for (const [index, event] of events.entries()) {
    assertContract('event', event);
    const sequence = index + 1;
    if (event.sequence !== sequence) {
      fail('event-chain', `sequence must be contiguous from 1; expected ${String(sequence)}`);
    }
    if (index === 0) {
      streamId = event.stream_id;
    } else if (event.stream_id !== streamId) {
      fail('event-chain', 'all events must share stream_id');
    }
    if (event.previous_hash !== previousHash) {
      fail('event-chain', 'previous_hash must link to the preceding event_hash');
    }
    previousHash = event.event_hash;
  }
};
