import ts from 'typescript';

const directCapabilities = new Map([
  ['addSignalListener', 'signal registration'],
  ['close', 'server shutdown'],
  ['removeSignalListener', 'signal removal'],
  ['serve', 'server startup'],
  ['shutdown', 'server shutdown'],
  ['upgradeWebSocket', 'websocket upgrades'],
]);
const resolverCapabilities = new Map([
  ['resolveServe', 'server startup'],
  ['resolveUpgradeWebSocket', 'websocket upgrades'],
]);

export function parseDenoSource(relativePath, content) {
  const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`Deno host-owned lifecycle contract check failed: ${relativePath} must remain valid TypeScript.`);
  }
  return sourceFile;
}

export function staticName(node) {
  const name = node && ts.isComputedPropertyName(node) ? node.expression : node;
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : undefined;
}

export function unwrapExpression(node) {
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

function memberName(node) {
  node = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isElementAccessExpression(node) ? staticName(node.argumentExpression) : undefined;
}

function memberReceiver(node) {
  node = unwrapExpression(node);
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ? unwrapExpression(node.expression)
    : undefined;
}

function capabilityOfExpression(node, bindings) {
  node = unwrapExpression(node);
  if (ts.isIdentifier(node)) return bindings.get(node.text);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return directCapabilities.get(memberName(node));
  }
  if (ts.isCallExpression(node)) {
    const target = unwrapExpression(node.expression);
    const targetName = memberName(target);
    if (targetName === 'bind') {
      const receiver = memberReceiver(target);
      return receiver ? capabilityOfExpression(receiver, bindings) : undefined;
    }
    const invokedName = ts.isIdentifier(target) ? target.text : targetName;
    return resolverCapabilities.get(invokedName);
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = capabilityOfExpression(node.whenTrue, bindings);
    const whenFalse = capabilityOfExpression(node.whenFalse, bindings);
    return whenTrue === whenFalse ? whenTrue : undefined;
  }
  return undefined;
}

function recordBinding(name, capability, bindings) {
  if (!capability || bindings.get(name) === capability) return false;
  bindings.set(name, capability);
  return true;
}

function collectBindings(node) {
  const bindings = new Map();
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    function visit(current) {
      if (ts.isVariableDeclaration(current) && current.initializer) {
        if (ts.isIdentifier(current.name)) {
          changed = recordBinding(
            current.name.text,
            capabilityOfExpression(current.initializer, bindings),
            bindings,
          ) || changed;
        } else if (ts.isObjectBindingPattern(current.name)) {
          for (const element of current.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const propertyName = staticName(element.propertyName ?? element.name);
            changed = recordBinding(element.name.text, directCapabilities.get(propertyName), bindings) || changed;
          }
        }
      }
      if (
        ts.isBinaryExpression(current) &&
        current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(current.left)
      ) {
        changed = recordBinding(
          current.left.text,
          capabilityOfExpression(current.right, bindings),
          bindings,
        ) || changed;
      }
      ts.forEachChild(current, visit);
    }
    visit(node);
    if (!changed) break;
  }
  return bindings;
}

function invokedCapability(call, bindings) {
  const target = unwrapExpression(call.expression);
  const targetName = memberName(target);
  if (targetName === 'bind') return undefined;
  if (targetName === 'call' || targetName === 'apply') {
    const receiver = memberReceiver(target);
    return receiver ? capabilityOfExpression(receiver, bindings) : undefined;
  }
  return capabilityOfExpression(target, bindings);
}

export function collectLifecycleCalls(node) {
  const bindings = collectBindings(node);
  const calls = [];
  function visit(current) {
    if (ts.isCallExpression(current)) {
      const capability = invokedCapability(current, bindings);
      if (capability) calls.push({ capability, node: current });
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return calls;
}

export function collectCallNames(node) {
  const names = new Set();
  function visit(current) {
    if (ts.isCallExpression(current)) {
      const target = unwrapExpression(current.expression);
      const name = ts.isIdentifier(target) ? target.text : memberName(target);
      if (name) names.add(name);
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return names;
}

export function findFunction(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

export function findClassMethod(sourceFile, className, methodName) {
  const classDeclaration = sourceFile.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  return classDeclaration?.members.find(
    (member) => ts.isMethodDeclaration(member) && staticName(member.name) === methodName,
  );
}

export function findCalls(node, expectedName) {
  const calls = [];
  function visit(current) {
    if (ts.isCallExpression(current)) {
      const target = unwrapExpression(current.expression);
      const name = ts.isIdentifier(target) ? target.text : memberName(target);
      if (name === expectedName) calls.push(current);
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return calls;
}
