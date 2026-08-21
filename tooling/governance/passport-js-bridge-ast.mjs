import ts from 'typescript';

function fail(relativePath, message) {
  throw new Error(`Passport.js bridge migration contract check failed: ${relativePath} ${message}.`);
}

function parseSource(relativePath, sourceText) {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length > 0) {
    const details = source.parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; ');
    fail(relativePath, `must remain valid TypeScript (${details})`);
  }
  return source;
}

function propertyInitializer(object, name) {
  const property = object.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && candidate.name.getText() === name);
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

function isIdentifierNamed(node, name) {
  return node !== undefined && ts.isIdentifier(node) && node.text === name;
}

function isOptionsValue(node) {
  return node !== undefined && ts.isObjectLiteralExpression(node) && node.properties.some((property) =>
    ts.isSpreadAssignment(property) && isIdentifierNamed(property.expression, 'options'));
}

function findReturnedObject(functionDeclaration) {
  let returnedObject;
  function visit(node) {
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      returnedObject = node.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(functionDeclaration);
  return returnedObject;
}

function returnedIdentifier(functionDeclaration) {
  const returnStatements = functionDeclaration.body?.statements.filter(ts.isReturnStatement) ?? [];
  const expression = returnStatements.length === 1 ? returnStatements[0].expression : undefined;
  return expression && ts.isIdentifier(expression) ? expression : undefined;
}

function isStrategyLoop(node) {
  if (!ts.isForOfStatement(node) || !isIdentifierNamed(node.expression, 'strategies') ||
    !ts.isVariableDeclarationList(node.initializer)) {
    return false;
  }
  const [declaration] = node.initializer.declarations;
  return node.initializer.declarations.length === 1 && isIdentifierNamed(declaration?.name, 'strategy');
}

function hasRegistryAssignment(strategyLoop, registryName) {
  let found = false;
  function visit(node) {
    if (ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(node.left) && isIdentifierNamed(node.left.expression, registryName) &&
      node.left.argumentExpression.getText() === 'strategy.name' && node.right.getText() === 'strategy.token') {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(strategyLoop.statement);
  return found;
}

export function enforcePassportBridgeSourceAst(readText) {
  const bridgePath = 'packages/passport/src/adapters/passport-js.ts';
  const bridgeSource = parseSource(bridgePath, readText(bridgePath));
  const factory = bridgeSource.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'createPassportJsStrategyBridge');
  const returnedBridge = factory && findReturnedObject(factory);
  if (!returnedBridge) {
    fail(bridgePath, 'must return a bridge object from createPassportJsStrategyBridge(...)');
  }
  const providers = propertyInitializer(returnedBridge, 'providers');
  const strategy = propertyInitializer(returnedBridge, 'strategy');
  const providerElements = providers && ts.isArrayLiteralExpression(providers)
    ? providers.elements.filter(ts.isObjectLiteralExpression)
    : [];
  const hasOptionsProvider = providerElements.some((element) =>
    isIdentifierNamed(propertyInitializer(element, 'provide'), 'optionsToken') &&
    isOptionsValue(propertyInitializer(element, 'useValue')));
  const hasAdapterProvider = providerElements.some((element) => {
    if (!isIdentifierNamed(propertyInitializer(element, 'provide'), 'adapterToken')) {
      return false;
    }
    const inject = propertyInitializer(element, 'inject');
    return inject && ts.isArrayLiteralExpression(inject) &&
      inject.elements.some((dependency) => isIdentifierNamed(dependency, 'strategyToken')) &&
      inject.elements.some((dependency) => isIdentifierNamed(dependency, 'optionsToken')) &&
      propertyInitializer(element, 'useFactory') !== undefined;
  });
  const strategyName = strategy && ts.isObjectLiteralExpression(strategy) && strategy.properties.some((property) =>
    ts.isShorthandPropertyAssignment(property) && property.name.text === 'name');
  const strategyToken = strategy && ts.isObjectLiteralExpression(strategy) && strategy.properties.some((property) =>
    ts.isPropertyAssignment(property) && property.name.getText() === 'token' &&
    isIdentifierNamed(property.initializer, 'adapterToken'));
  if (!hasOptionsProvider) {
    fail(bridgePath, 'must expose an optionsToken value provider');
  }
  if (!hasAdapterProvider) {
    fail(bridgePath, 'must expose an adapterToken provider injected with strategyToken and optionsToken');
  }
  if (!strategyName || !strategyToken) {
    fail(bridgePath, 'must return the matching named adapter registration');
  }

  const modulePath = 'packages/passport/src/module.ts';
  const moduleSource = parseSource(modulePath, readText(modulePath));
  const registryFactory = moduleSource.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'createStrategyRegistry');
  const registry = registryFactory && returnedIdentifier(registryFactory);
  const strategyLoop = registryFactory?.body?.statements.find(isStrategyLoop);
  if (!registry || !strategyLoop || !hasRegistryAssignment(strategyLoop, registry.text)) {
    fail(modulePath, 'must map each named strategy to its provider token');
  }
}
