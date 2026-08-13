import ts from 'typescript';

import { collectLifecycleCallsWithProvenance } from './deno-lifecycle-flow.mjs';

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

export function collectLifecycleCalls(node, initialProvenance) {
  return collectLifecycleCallsWithProvenance(node, initialProvenance);
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
