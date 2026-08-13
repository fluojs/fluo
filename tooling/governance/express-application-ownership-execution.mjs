import ts from 'typescript';

import {
  expressionReferences,
  isThisMember,
  staticName,
  unwrapExpression,
} from './express-application-ownership-ast.mjs';

function functionBody(node) {
  return node.body && ts.isBlock(node.body) ? node.body : undefined;
}

export function inspectConstructorExecution({
  constructor,
  helperNames,
  isOwnedFactoryCall,
  nativeParameterNames,
}) {
  const appAssignments = [];
  const localFunctions = new Map();
  const nativeMounts = [];
  const ownedLocals = new Set();
  const routerMounts = [];
  let order = 0;

  function inspectExpression(node, bindings) {
    node = unwrapExpression(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (isThisMember(node.left, 'app')) {
        const value = unwrapExpression(node.right);
        appAssignments.push(
          isOwnedFactoryCall(value, helperNames) ||
            (ts.isIdentifier(value) && ownedLocals.has(value.text)),
        );
      }
      return;
    }
    if (!ts.isCallExpression(node)) {
      return;
    }

    const target = unwrapExpression(node.expression);
    if (ts.isIdentifier(target)) {
      const localFunction = localFunctions.get(target.text);
      const body = localFunction ? functionBody(localFunction) : undefined;
      if (body) {
        inspectStatements(body.statements, bindings);
      }
      return;
    }
    if (ts.isArrowFunction(target) || ts.isFunctionExpression(target)) {
      const body = functionBody(target);
      if (body) {
        inspectStatements(body.statements, bindings);
      }
      return;
    }

    const methodName =
      ts.isPropertyAccessExpression(target)
        ? target.name.text
        : ts.isElementAccessExpression(target)
          ? staticName(target.argumentExpression)
          : undefined;
    const receiver =
      ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)
        ? target.expression
        : undefined;
    if (methodName !== 'use' || !receiver || !isThisMember(receiver, 'app')) {
      return;
    }
    order += 1;
    if (node.arguments.some((argument) => isThisMember(argument, 'router'))) {
      routerMounts.push(order);
    }
    if (node.arguments.some((argument) => expressionReferences(argument, bindings))) {
      nativeMounts.push(order);
    }
  }

  function inspectStatement(statement, bindings) {
    if (ts.isBlock(statement)) {
      inspectStatements(statement.statements, bindings);
      return;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue;
        }
        const initializer = unwrapExpression(declaration.initializer);
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          localFunctions.set(declaration.name.text, initializer);
          continue;
        }
        if (
          isOwnedFactoryCall(initializer, helperNames) ||
          (ts.isIdentifier(initializer) && ownedLocals.has(initializer.text))
        ) {
          ownedLocals.add(declaration.name.text);
        }
        inspectExpression(initializer, bindings);
      }
      return;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      localFunctions.set(statement.name.text, statement);
      return;
    }
    if (ts.isExpressionStatement(statement)) {
      inspectExpression(statement.expression, bindings);
      return;
    }
    if (ts.isForOfStatement(statement) && expressionReferences(statement.expression, bindings)) {
      const loopBindings = new Set(bindings);
      if (ts.isVariableDeclarationList(statement.initializer)) {
        for (const declaration of statement.initializer.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            loopBindings.add(declaration.name.text);
          }
        }
      }
      inspectStatement(statement.statement, loopBindings);
      return;
    }
    if (ts.isIfStatement(statement)) {
      const condition = unwrapExpression(statement.expression);
      if (condition.kind === ts.SyntaxKind.TrueKeyword) {
        inspectStatement(statement.thenStatement, bindings);
      } else if (condition.kind === ts.SyntaxKind.FalseKeyword && statement.elseStatement) {
        inspectStatement(statement.elseStatement, bindings);
      }
    }
  }

  function inspectStatements(statements, bindings) {
    for (const statement of statements) {
      inspectStatement(statement, bindings);
    }
  }

  inspectStatements(constructor.body.statements, nativeParameterNames);
  return { appAssignments, nativeMounts, routerMounts };
}
