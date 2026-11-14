// Shared routing values only. Dispatch and runtime availability belong to the lead.
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
    super(`${code}: ${subagent_type}`);
    this.name = 'DispatchPreparationError';
    this.kind = 'input-preparation';
    this.code = code;
    this.subagent_type = subagent_type;
    this.fix_back_eligible = false;
  }
}

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
