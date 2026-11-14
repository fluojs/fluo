// Shared routing values and registration reading. Runtime availability belongs to the lead.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = (subagent_type) => Object.freeze({ subagent_type });
export const stageTargets = Object.freeze({
  preflight: target('fluo-issue-preflight'),
  implement: target('fluo-issue-implementer'),
  'fix-back': target('fluo-issue-implementer'),
  retro: target('fluo-retrospective'),
});
export const reviewerTargets = Object.freeze({
  contract: target('fluo-contract-reviewer'),
  code: target('fluo-code-reviewer'),
  verification: target('fluo-verification-reviewer'),
});
export const reviewerCategories = Object.freeze([
  'architect', 'artistry', 'deep-high', 'deep-low', 'quick', 'ultrabrain',
  'unspecified-high', 'unspecified-low', 'visual-engineering', 'writing',
]);

export class DispatchPreparationError extends TypeError {
  constructor(subagent_type, code = 'dispatch-target-unavailable') {
    super(code === 'dispatch-registration-unreadable'
      ? `${code}: .omo/omo.jsonc registration could not be read`
      : `${code}: ${subagent_type}`);
    this.name = 'DispatchPreparationError';
    this.kind = 'input-preparation';
    this.code = code;
    this.subagent_type = subagent_type;
    this.fix_back_eligible = false;
  }
}

// Blank comments and trailing commas only outside JSON strings. JSON.parse
// still owns the grammar, so malformed input cannot become a registration.
const parseRegistration = (source) => {
  const characters = source.split('');
  let quoted = false;
  let previous = '';
  let comma = -1;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '\\') index++;
      else if (character === '"') {
        quoted = false;
        previous = '"';
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      comma = -1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      while (index < source.length && !['\r', '\n'].includes(source[index])) {
        characters[index++] = ' ';
      }
      index--;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) throw new SyntaxError('Unterminated registration comment');
      while (index <= end + 1) {
        if (!['\r', '\n'].includes(source[index])) characters[index] = ' ';
        index++;
      }
      index--;
      continue;
    }
    if (/\s/u.test(character)) continue;
    if ((character === '}' || character === ']') && comma !== -1) characters[comma] = ' ';
    // A comma after an opener, colon or another comma is invalid JSON, not a
    // trailing comma. Leave it for JSON.parse to reject.
    comma = character === ',' && previous && !'{[:,'.includes(previous) ? index : -1;
    previous = character;
  }
  return JSON.parse(characters.join(''));
};

export const readRegisteredAgents = (root) => {
  try {
    return parseRegistration(readFileSync(resolve(root, '.omo/omo.jsonc'), 'utf8'))?.agents;
  } catch (cause) {
    const failure = new DispatchPreparationError(undefined, 'dispatch-registration-unreadable');
    failure.cause = cause;
    throw failure;
  }
};

export const dispatchFor = (phase, axes = []) => phase === 'review'
  ? Object.fromEntries(axes.map((axis) => [axis, reviewerTargets[axis]]))
  : stageTargets[phase];

export const assertAgentIdentity = (expected, actual) => {
  if (!expected || actual !== expected.subagent_type) {
    throw new TypeError(`Expected assigned agent ${expected?.subagent_type}, received ${actual}`);
  }
};

export const validateDispatchTarget = (dispatch, agents, unavailable = []) => {
  const name = dispatch.subagent_type;
  if (!agents || !Object.hasOwn(agents, name) || unavailable.includes(name)) {
    throw new DispatchPreparationError(name);
  }
};

export const validateDispatchRegistration = (agents, unavailable = []) => {
  for (const dispatch of [...Object.values(stageTargets), ...Object.values(reviewerTargets)]) {
    validateDispatchTarget(dispatch, agents, unavailable);
  }
};

export const validateReviewerRoutes = (reviewers) => {
  for (const [reviewer, route] of Object.entries(reviewers)) {
    if (!reviewerCategories.includes(route?.category)) {
      throw new TypeError(`Unknown reviewer category: ${reviewer}: ${route?.category}`);
    }
  }
};

// An unavailable stage target is input preparation, never an implementation defect.
export const validateUnavailableTarget = (phase, error, axes = []) => {
  const expected = phase === 'review'
    ? axes.map((axis) => reviewerTargets[axis]?.subagent_type)
    : [stageTargets[phase]?.subagent_type];
  if (!expected.includes(error?.subagent_type) || typeof error.subagent_type !== 'string'
    || error.kind !== 'input-preparation' || error.code !== 'dispatch-target-unavailable'
    || error.fix_back_eligible !== false) {
    throw new TypeError('Unavailable target must bind an assigned stage agent and input-preparation');
  }
};
