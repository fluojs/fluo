import ts from 'typescript';

import { enforcePassportBridgeExampleTypes } from './passport-js-bridge-typecheck.mjs';

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

function referencesBridgeFactory(source) {
  let found = false;
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === 'createPassportJsStrategyBridge') {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function extractUniqueBridgeFence(relativePath, markdown) {
  const sources = [...markdown.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? '');
  const candidates = sources
    .map((sourceText) => ({ source: parseSource(relativePath, sourceText), sourceText }))
    .filter(({ source }) => referencesBridgeFactory(source));
  if (candidates.length !== 1) {
    fail(relativePath, 'must include one unique Passport.js bridge example fence');
  }
  return candidates[0];
}

function requireBridgeCall(relativePath, source) {
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === 'googleBridge');
  const bridgeCall = declaration?.initializer;
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
}

function requireAuthModuleMetadata(relativePath, source) {
  const authModule = source.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'AuthModule');
  const decorators = authModule && ts.canHaveDecorators(authModule) ? ts.getDecorators(authModule) ?? [] : [];
  const moduleDecorator = decorators
    .map((decorator) => decorator.expression)
    .find((expression) => callName(expression) === 'Module');
  const metadata = moduleDecorator && ts.isCallExpression(moduleDecorator) ? moduleDecorator.arguments[0] : undefined;
  if (!metadata || !ts.isObjectLiteralExpression(metadata)) {
    fail(relativePath, 'must define coherent @Module metadata on AuthModule');
  }
  return metadata;
}

function enforceProviders(relativePath, metadata) {
  const providers = propertyInitializer(metadata, 'providers');
  if (!providers || !ts.isArrayLiteralExpression(providers)) {
    fail(relativePath, 'must define the AuthModule providers list');
  }
  const hasGoogleStrategy = providers.elements.some((element) =>
    ts.isIdentifier(element) && element.text === 'GoogleStrategy');
  const hasBridgeProviders = providers.elements.some((element) =>
    ts.isSpreadElement(element) && isNamedPropertyAccess(element.expression, 'googleBridge', 'providers'));
  if (!hasGoogleStrategy || !hasBridgeProviders) {
    fail(relativePath, 'must register GoogleStrategy and ...googleBridge.providers together');
  }
}

function enforceRegistration(relativePath, metadata) {
  const imports = propertyInitializer(metadata, 'imports');
  const passportCall = imports && ts.isArrayLiteralExpression(imports)
    ? imports.elements.find((element) => callName(element) === 'PassportModule.forRoot')
    : undefined;
  const registrations = passportCall && ts.isCallExpression(passportCall) ? passportCall.arguments[1] : undefined;
  if (!registrations || !ts.isArrayLiteralExpression(registrations) ||
    !registrations.elements.some((element) => isNamedPropertyAccess(element, 'googleBridge', 'strategy'))) {
    fail(relativePath, 'must register googleBridge.strategy inside AuthModule imports');
  }
}

export function enforcePassportBridgeExample(relativePath, markdown) {
  const { source, sourceText } = extractUniqueBridgeFence(relativePath, markdown);
  requireBridgeCall(relativePath, source);
  const metadata = requireAuthModuleMetadata(relativePath, source);
  enforceProviders(relativePath, metadata);
  enforceRegistration(relativePath, metadata);
  enforcePassportBridgeExampleTypes(relativePath, sourceText);
}
