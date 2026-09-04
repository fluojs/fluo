import {
  createSourceFile,
  forEachChild,
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isConditionalExpression,
  isForOfStatement,
  isFunctionDeclaration,
  isIdentifier,
  isNumericLiteral,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isStringLiteral,
  isVariableDeclarationList,
  isVariableStatement,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} from 'typescript';

function propertyNameText(name) {
  return isIdentifier(name) || isStringLiteral(name) ? name.text : undefined;
}

function findProperty(objectLiteral, propertyName) {
  return objectLiteral.properties.find(
    (property) => isPropertyAssignment(property) && propertyNameText(property.name) === propertyName,
  );
}

function isReportStatusComparison(expression) {
  if (!isBinaryExpression(expression)) {
    return undefined;
  }

  const operator = expression.operatorToken.kind;
  if (operator !== SyntaxKind.EqualsEqualsEqualsToken && operator !== SyntaxKind.ExclamationEqualsEqualsToken) {
    return undefined;
  }

  const operands = [expression.left, expression.right];
  const statusOperand = operands.find(
    (operand) => isPropertyAccessExpression(operand)
      && isIdentifier(operand.expression)
      && operand.expression.text === 'reportWithPlatform'
      && operand.name.text === 'status',
  );
  const okOperand = operands.find((operand) => isStringLiteral(operand) && operand.text === 'ok');

  if (statusOperand === undefined || okOperand === undefined) {
    return undefined;
  }

  return operator === SyntaxKind.EqualsEqualsEqualsToken;
}

function isNumericValue(expression, value) {
  return isNumericLiteral(expression) && Number(expression.text) === value;
}

function hasHealthStatusContract(healthCheck) {
  if (!isArrowFunction(healthCheck) || !isBlock(healthCheck.body)) {
    return false;
  }

  const returnedObject = healthCheck.body.statements
    .filter(isReturnStatement)
    .map((statement) => statement.expression)
    .find((expression) => expression !== undefined && isObjectLiteralExpression(expression));
  if (returnedObject === undefined || !isObjectLiteralExpression(returnedObject)) {
    return false;
  }

  const statusCodeProperty = findProperty(returnedObject, 'statusCode');
  if (statusCodeProperty === undefined || !isPropertyAssignment(statusCodeProperty)
    || !isConditionalExpression(statusCodeProperty.initializer)) {
    return false;
  }

  const statusCode = statusCodeProperty.initializer;
  const healthyWhenConditionTrue = isReportStatusComparison(statusCode.condition);
  if (healthyWhenConditionTrue === undefined) {
    return false;
  }

  return healthyWhenConditionTrue
    ? isNumericValue(statusCode.whenTrue, 200) && isNumericValue(statusCode.whenFalse, 503)
    : isNumericValue(statusCode.whenTrue, 503) && isNumericValue(statusCode.whenFalse, 200);
}

function callMatches(node, receiverName, methodName, argumentName) {
  return isCallExpression(node)
    && isPropertyAccessExpression(node.expression)
    && isIdentifier(node.expression.expression)
    && node.expression.expression.text === receiverName
    && node.expression.name.text === methodName
    && node.arguments.length === 1
    && isIdentifier(node.arguments[0])
    && node.arguments[0].text === argumentName;
}

function hasReadinessRegistration(functionBody) {
  return functionBody.statements.some((statement) => {
    if (!isForOfStatement(statement) || !isIdentifier(statement.expression)
      || statement.expression.text !== 'readinessChecks'
      || !isVariableDeclarationList(statement.initializer)) {
      return false;
    }

    const declaration = statement.initializer.declarations[0];
    if (declaration === undefined || !isIdentifier(declaration.name)) {
      return false;
    }

    let found = false;
    forEachChild(statement.statement, function visit(node) {
      if (callMatches(node, 'healthModule', 'addReadinessCheck', declaration.name.text)) {
        found = true;
      }
      forEachChild(node, visit);
    });
    return found;
  });
}

function hasLivenessRegistration(functionBody) {
  let found = false;
  forEachChild(functionBody, function visit(node) {
    if (isCallExpression(node)
      && isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'addLivenessCheck') {
      found = true;
    }
    forEachChild(node, visit);
  });
  return found;
}

export function enforceTerminusRuntimeSourceContract(runtimeSource, assertContract) {
  const sourceFile = createSourceFile(
    'packages/terminus/src/module.ts',
    runtimeSource,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  );
  const runtimeModuleFactory = sourceFile.statements.find(
    (statement) => isFunctionDeclaration(statement)
      && statement.name?.text === 'createTerminusRuntimeModule'
      && statement.body !== undefined,
  );
  assertContract(
    runtimeModuleFactory?.body !== undefined,
    'packages/terminus/src/module.ts must define createTerminusRuntimeModule().',
  );

  const healthModuleDeclaration = runtimeModuleFactory.body.statements
    .filter(isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => isIdentifier(declaration.name) && declaration.name.text === 'healthModule');
  const healthModuleCall = healthModuleDeclaration?.initializer;
  const healthModuleOptions = healthModuleCall !== undefined
    && isCallExpression(healthModuleCall)
    && isPropertyAccessExpression(healthModuleCall.expression)
    && isIdentifier(healthModuleCall.expression.expression)
    && healthModuleCall.expression.expression.text === 'HealthModule'
    && healthModuleCall.expression.name.text === 'forRoot'
    && healthModuleCall.arguments[0] !== undefined
    && isObjectLiteralExpression(healthModuleCall.arguments[0])
    ? healthModuleCall.arguments[0]
    : undefined;
  const healthCheckProperty = healthModuleOptions === undefined
    ? undefined
    : findProperty(healthModuleOptions, 'healthCheck');

  assertContract(
    healthCheckProperty !== undefined
      && isPropertyAssignment(healthCheckProperty)
      && hasHealthStatusContract(healthCheckProperty.initializer),
    'packages/terminus/src/module.ts must keep Terminus aggregated health and unhealthy HTTP 503 behavior.',
  );
  assertContract(
    hasReadinessRegistration(runtimeModuleFactory.body),
    'packages/terminus/src/module.ts must keep Terminus binary readiness behavior.',
  );
  assertContract(
    !hasLivenessRegistration(runtimeModuleFactory.body),
    'packages/terminus/src/module.ts must not register a default liveness route.',
  );
}
