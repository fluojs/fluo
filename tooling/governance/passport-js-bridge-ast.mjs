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

function callName(node) {
  if (!ts.isCallExpression(node)) {
    return undefined;
  }
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  return ts.isPropertyAccessExpression(node.expression)
    ? `${node.expression.expression.getText()}.${node.expression.name.text}`
    : undefined;
}

function findCall(source, expectedName) {
  let result;
  function visit(node) {
    if (callName(node) === expectedName) {
      result = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function propertyInitializer(object, name) {
  const property = object.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && candidate.name.getText() === name);
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

function isNamedPropertyAccess(node, receiver, name) {
  return ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === receiver &&
    node.name.text === name;
}

function extractBridgeFence(relativePath, markdown) {
  const fence = [...markdown.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? '')
    .find((candidate) => candidate.includes('createPassportJsStrategyBridge'));
  if (!fence) {
    fail(relativePath, 'must include a TypeScript createPassportJsStrategyBridge example');
  }
  return fence;
}

export function enforcePassportBridgeExampleAst(relativePath, markdown) {
  const source = parseSource(relativePath, extractBridgeFence(relativePath, markdown));
  const bridgeDeclaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'googleBridge');
  const bridgeCall = bridgeDeclaration?.initializer;
  if (!bridgeCall || !ts.isCallExpression(bridgeCall) || callName(bridgeCall) !== 'createPassportJsStrategyBridge') {
    fail(relativePath, 'must assign createPassportJsStrategyBridge(...) to googleBridge');
  }
  const [nameArgument, tokenArgument, optionsArgument] = bridgeCall.arguments;
  if (!nameArgument || !ts.isStringLiteral(nameArgument) || nameArgument.text !== 'google') {
    fail(relativePath, 'must register the google strategy name');
  }
  if (!tokenArgument || !ts.isIdentifier(tokenArgument) || tokenArgument.text !== 'GoogleStrategy') {
    fail(relativePath, 'must pass GoogleStrategy as the bridge provider token');
  }
  if (!optionsArgument || !ts.isObjectLiteralExpression(optionsArgument) || !propertyInitializer(optionsArgument, 'mapPrincipal')) {
    fail(relativePath, 'must define mapPrincipal(...) in the bridge options');
  }

  const moduleCall = findCall(source, 'Module');
  const moduleMetadata = moduleCall?.arguments[0];
  if (!moduleMetadata || !ts.isObjectLiteralExpression(moduleMetadata)) {
    fail(relativePath, 'must define @Module metadata');
  }
  const providers = propertyInitializer(moduleMetadata, 'providers');
  if (!providers || !ts.isArrayLiteralExpression(providers)) {
    fail(relativePath, 'must define the module providers list');
  }
  const hasStrategyProvider = providers.elements.some((element) =>
    ts.isIdentifier(element) && element.text === 'GoogleStrategy');
  const hasBridgeProviders = providers.elements.some((element) =>
    ts.isSpreadElement(element) && isNamedPropertyAccess(element.expression, 'googleBridge', 'providers'));
  if (!hasStrategyProvider || !hasBridgeProviders) {
    fail(relativePath, 'must register GoogleStrategy and ...googleBridge.providers together');
  }

  const passportCall = findCall(source, 'PassportModule.forRoot');
  const registrations = passportCall?.arguments[1];
  if (!registrations || !ts.isArrayLiteralExpression(registrations) ||
    !registrations.elements.some((element) => isNamedPropertyAccess(element, 'googleBridge', 'strategy'))) {
    fail(relativePath, 'must register googleBridge.strategy with PassportModule.forRoot(...)');
  }
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
  const hasAdapterProvider = providers && ts.isArrayLiteralExpression(providers) && providers.elements.some((element) => {
    if (!ts.isObjectLiteralExpression(element)) {
      return false;
    }
    const inject = propertyInitializer(element, 'inject');
    return inject && ts.isArrayLiteralExpression(inject) &&
      inject.elements.some((dependency) => ts.isIdentifier(dependency) && dependency.text === 'strategyToken') &&
      inject.elements.some((dependency) => ts.isIdentifier(dependency) && dependency.text === 'optionsToken') &&
      propertyInitializer(element, 'useFactory') !== undefined;
  });
  const strategyName = strategy && ts.isObjectLiteralExpression(strategy) && strategy.properties.some((property) =>
    ts.isShorthandPropertyAssignment(property) && property.name.text === 'name');
  const strategyToken = strategy && ts.isObjectLiteralExpression(strategy) && strategy.properties.some((property) =>
    ts.isPropertyAssignment(property) && property.name.getText() === 'token' &&
    ts.isIdentifier(property.initializer) && property.initializer.text === 'adapterToken');
  if (!hasAdapterProvider || !strategyName || !strategyToken) {
    fail(bridgePath, 'must return injectable bridge providers and the matching named adapter registration');
  }

  const modulePath = 'packages/passport/src/module.ts';
  const moduleSource = parseSource(modulePath, readText(modulePath));
  let hasRegistryAssignment = false;
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(node.left) && node.left.expression.getText() === 'registry' &&
      node.left.argumentExpression.getText() === 'strategy.name' && node.right.getText() === 'strategy.token') {
      hasRegistryAssignment = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(moduleSource);
  if (!hasRegistryAssignment) {
    fail(modulePath, 'must map each named strategy to its provider token');
  }
}
