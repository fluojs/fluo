import ts from 'typescript';

import { cloneLifecycleScopes, mergeLifecycleBranches } from './deno-lifecycle-branch-flow.mjs';

const receiverStates = {
  application: { kind: 'receiver', receiver: 'application' },
  deno: { kind: 'receiver', receiver: 'deno' },
  globalThis: { kind: 'receiver', receiver: 'globalThis' },
  server: { kind: 'receiver', receiver: 'server' },
};
const memberCapabilities = new Map([
  ['application:close', 'server shutdown'],
  ['deno:addSignalListener', 'signal registration'],
  ['deno:removeSignalListener', 'signal removal'],
  ['deno:serve', 'server startup'],
  ['deno:upgradeWebSocket', 'websocket upgrades'],
  ['server:close', 'server shutdown'],
  ['server:shutdown', 'server shutdown'],
]);
const typeStates = new Map([
  ['Application', receiverStates.application],
  ['DenoGlobalLike', receiverStates.deno],
  ['DenoServeController', receiverStates.server],
  ['DenoServeFunction', capabilityState('server startup')],
  ['DenoUpgradeWebSocketFunction', capabilityState('websocket upgrades')],
]);

function capabilityState(capability, receiver) {
  return { capability, kind: 'capability', receiver };
}

function staticName(node) {
  const name = node && ts.isComputedPropertyName(node) ? node.expression : node;
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : undefined;
}

function unwrap(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isPartiallyEmittedExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function memberParts(node) {
  node = unwrap(node);
  if (ts.isPropertyAccessExpression(node)) return { name: node.name.text, receiver: unwrap(node.expression) };
  if (ts.isElementAccessExpression(node)) {
    return { name: staticName(node.argumentExpression), receiver: unwrap(node.expression) };
  }
  return {};
}

function sameState(left, right) {
  if (!left || !right) return left === right;
  return left?.kind === right?.kind &&
    left?.receiver === right?.receiver &&
    left?.capability === right?.capability;
}

function mergeBranchState(left, right) {
  if (sameState(left, right)) return left;
  if (left == null) return right;
  if (right == null) return left;
  return null;
}

function lookup(scopes, name) {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (scopes[index].has(name)) return scopes[index].get(name) ?? undefined;
  }
  return undefined;
}

function write(scopes, name, state, declaration) {
  if (declaration) {
    scopes[scopes.length - 1].set(name, state ?? null);
    return;
  }
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (scopes[index].has(name)) {
      scopes[index].set(name, state ?? null);
      return;
    }
  }
  scopes[scopes.length - 1].set(name, state ?? null);
}

function stateFromType(node) {
  if (!node) return undefined;
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) return typeStates.get(node.typeName.text);
  if (ts.isUnionTypeNode(node)) {
    const states = node.types.map(stateFromType).filter(Boolean);
    return states.length > 0 && states.every((state) => sameState(state, states[0])) ? states[0] : undefined;
  }
  return undefined;
}

function memberState(receiver, name) {
  if (!receiver || receiver.kind !== 'receiver' || !name) return undefined;
  if (receiver.receiver === 'globalThis' && name === 'Deno') return receiverStates.deno;
  const capability = memberCapabilities.get(`${receiver.receiver}:${name}`);
  return capability ? capabilityState(capability, receiver.receiver) : undefined;
}

function expressionState(node, scopes) {
  node = unwrap(node);
  if (ts.isIdentifier(node)) {
    return lookup(scopes, node.text);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const { name, receiver } = memberParts(node);
    return memberState(expressionState(receiver, scopes), name);
  }
  if (ts.isCallExpression(node)) {
    const target = unwrap(node.expression);
    const { name, receiver } = memberParts(target);
    if (name === 'bind') {
      const callable = expressionState(receiver, scopes);
      if (callable?.kind !== 'capability') return undefined;
      const boundReceiver = node.arguments[0] ? expressionState(node.arguments[0], scopes) : undefined;
      return callable.receiver && boundReceiver?.receiver !== callable.receiver ? undefined : callable;
    }
    const callable = expressionState(target, scopes);
    if (callable?.kind === 'factory') return callable.output;
    if (callable?.kind === 'capability' && callable.capability === 'server startup') {
      return receiverStates.server;
    }
    return undefined;
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = expressionState(node.whenTrue, scopes);
    const whenFalse = expressionState(node.whenFalse, scopes);
    return sameState(whenTrue, whenFalse) ? whenTrue : undefined;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return expressionState(node.left, scopes) ?? expressionState(node.right, scopes);
  }
  return undefined;
}

function writePattern(pattern, source, scopes, declaration) {
  pattern = unwrap(pattern);
  if (ts.isIdentifier(pattern)) {
    write(scopes, pattern.text, source, declaration);
    return;
  }
  if (ts.isObjectBindingPattern(pattern)) {
    for (const element of pattern.elements) {
      writePattern(element.name, memberState(source, staticName(element.propertyName ?? element.name)), scopes, declaration);
    }
    return;
  }
  if (ts.isObjectLiteralExpression(pattern)) {
    for (const property of pattern.properties) {
      if (ts.isPropertyAssignment(property)) {
        writePattern(property.initializer, memberState(source, staticName(property.name)), scopes, declaration);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        write(scopes, property.name.text, memberState(source, property.name.text), declaration);
      }
    }
  }
}

function invokedCapability(call, scopes) {
  const target = unwrap(call.expression);
  const { name, receiver } = memberParts(target);
  if (name === 'bind') return undefined;
  if (name === 'call' || name === 'apply') {
    const callable = expressionState(receiver, scopes);
    if (callable?.kind !== 'capability') return undefined;
    const callReceiver = call.arguments[0] ? expressionState(call.arguments[0], scopes) : undefined;
    return callable.receiver && callReceiver?.receiver !== callable.receiver ? undefined : callable.capability;
  }
  const state = expressionState(target, scopes);
  return state?.kind === 'capability' ? state.capability : undefined;
}

function initialBindings(initialProvenance) {
  const bindings = new Map([
    ['Deno', receiverStates.deno],
    ['globalThis', receiverStates.globalThis],
  ]);
  for (const [name, receiver] of Object.entries(initialProvenance.receivers ?? {})) {
    bindings.set(name, receiverStates[receiver] ?? null);
  }
  for (const [name, capability] of Object.entries(initialProvenance.capabilityFactories ?? {})) {
    bindings.set(name, { kind: 'factory', output: capabilityState(capability) });
  }
  for (const [name, receiver] of Object.entries(initialProvenance.receiverFactories ?? {})) {
    bindings.set(name, { kind: 'factory', output: receiverStates[receiver] });
  }
  return bindings;
}

function visitFunction(node, scopes, calls, visit) {
  const localScopes = scopes.map((scope) => new Map(scope));
  localScopes.push(new Map());
  for (const parameter of node.parameters) {
    const initialState = scopes.length === 1 && ts.isIdentifier(parameter.name)
      ? lookup(scopes, parameter.name.text)
      : undefined;
    writePattern(parameter.name, stateFromType(parameter.type) ?? initialState, localScopes, true);
  }
  if (node.body) visit(node.body, localScopes, calls);
}

export function collectLifecycleCallsWithProvenance(node, initialProvenance = {}) {
  const calls = [];
  function visit(current, scopes) {
    if (ts.isFunctionLike(current)) {
      visitFunction(current, scopes, calls, visit);
      return;
    }
    if (ts.isBlock(current)) {
      scopes.push(new Map());
      for (const statement of current.statements) visit(statement, scopes);
      scopes.pop();
      return;
    }
    if (ts.isIfStatement(current)) {
      visit(current.expression, scopes);
      const thenScopes = cloneLifecycleScopes(scopes);
      const elseScopes = cloneLifecycleScopes(scopes);
      visit(current.thenStatement, thenScopes);
      if (current.elseStatement) visit(current.elseStatement, elseScopes);
      mergeLifecycleBranches(scopes, [thenScopes, elseScopes], mergeBranchState);
      return;
    }
    if (ts.isVariableDeclaration(current)) {
      if (current.initializer) visit(current.initializer, scopes);
      const state = current.initializer ? expressionState(current.initializer, scopes) : stateFromType(current.type);
      writePattern(current.name, state, scopes, true);
      return;
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      visit(current.right, scopes);
      writePattern(current.left, expressionState(current.right, scopes), scopes, false);
      return;
    }
    if (ts.isCallExpression(current)) {
      const capability = invokedCapability(current, scopes);
      if (capability) calls.push({ capability, node: current });
    }
    ts.forEachChild(current, (child) => visit(child, scopes));
  }
  visit(node, [initialBindings(initialProvenance)]);
  return calls;
}
