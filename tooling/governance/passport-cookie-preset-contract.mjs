import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cookieAuthModulePath = 'packages/passport/src/cookie/cookie-auth-module.ts';
const platformGovernancePath = 'tooling/governance/verify-platform-consistency-governance.mjs';

function findCookieAuthForRoot(sourceFile) {
  let forRoot;

  function visit(node) {
    if (
      ts.isClassDeclaration(node)
      && node.name?.text === 'CookieAuthModule'
    ) {
      forRoot = node.members.find((member) =>
        ts.isMethodDeclaration(member)
        && member.name.getText(sourceFile) === 'forRoot'
        && member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
      );
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return forRoot;
}

function isPassportRegistration(node, sourceFile) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText(sourceFile) === 'PassportModule'
    && node.expression.name.text === 'forRoot';
}

function findPassportRegistrationsInReturnedModuleImports(forRoot, sourceFile) {
  const returnedModule = forRoot.body?.statements.find((statement) =>
    ts.isReturnStatement(statement)
    && statement.expression !== undefined
    && ts.isCallExpression(statement.expression)
    && ts.isIdentifier(statement.expression.expression)
    && statement.expression.expression.text === 'defineModule'
    && ts.isObjectLiteralExpression(statement.expression.arguments[1]),
  );
  const definition = returnedModule?.expression?.arguments[1];

  if (!definition || !ts.isObjectLiteralExpression(definition)) {
    return [];
  }

  const imports = definition.properties.find((property) =>
    ts.isPropertyAssignment(property)
    && property.name.getText(sourceFile) === 'imports'
    && ts.isArrayLiteralExpression(property.initializer),
  );

  if (!imports || !ts.isPropertyAssignment(imports) || !ts.isArrayLiteralExpression(imports.initializer)) {
    return [];
  }

  return imports.initializer.elements.filter((element) => isPassportRegistration(element, sourceFile));
}

function hasDefaultStrategySpread(options, parameterName) {
  if (!ts.isObjectLiteralExpression(options)) {
    return false;
  }

  const defaultStrategies = options.properties
    .map((property, index) => ({ index, property }))
    .filter(({ property }) =>
      ts.isPropertyAssignment(property) && property.name.getText() === 'defaultStrategy');
  const passportOptionSpreads = options.properties
    .map((property, index) => ({ index, property }))
    .filter(({ property }) =>
      ts.isSpreadAssignment(property) && property.expression.getText() === parameterName);

  return defaultStrategies.length === 1
    && passportOptionSpreads.length === 1
    && passportOptionSpreads[0].index < defaultStrategies[0].index
    && ts.isPropertyAssignment(defaultStrategies[0].property)
    && defaultStrategies[0].property.initializer.getText() ===
      `${parameterName}.defaultStrategy ?? COOKIE_AUTH_STRATEGY_NAME`;
}

function hasCookieRegistration(strategies) {
  return ts.isArrayLiteralExpression(strategies)
    && strategies.elements.some((element) =>
      ts.isObjectLiteralExpression(element)
      && element.properties.some((property) =>
        ts.isPropertyAssignment(property)
        && property.name.getText() === 'name'
        && property.initializer.getText() === 'COOKIE_AUTH_STRATEGY_NAME',
      )
      && element.properties.some((property) =>
        ts.isPropertyAssignment(property)
        && property.name.getText() === 'token'
        && property.initializer.getText() === 'CookieAuthStrategy',
      ),
    );
}

function hasAdditionalStrategiesSpread(strategies, parameterName) {
  return ts.isArrayLiteralExpression(strategies)
    && strategies.elements.some((element) =>
      ts.isSpreadElement(element) && element.expression.getText() === parameterName,
    );
}

function hasOneDirectMainPassportCookiePresetGuardInvocation(sourceFile) {
  const mains = sourceFile.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'main');

  if (mains.length !== 1 || mains[0].body === undefined) {
    return false;
  }

  let invocations = 0;
  let terminated = false;
  for (const statement of mains[0].body.statements) {
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
      terminated = true;
    }
    if (
      ts.isExpressionStatement(statement)
      && ts.isCallExpression(statement.expression)
      && ts.isIdentifier(statement.expression.expression)
      && statement.expression.expression.text === 'enforcePassportCookiePresetContract'
    ) {
      if (terminated) {
        return false;
      }
      invocations += 1;
    }
  }
  return invocations === 1;
}

/**
 * Enforces the executable cookie preset recipe: `CookieAuthModule.forRoot(...)`
 * owns one Passport registry and structurally composes application-supplied named
 * strategies into it.
 */
export function enforcePassportCookiePresetContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  const sourceText = readText(cookieAuthModulePath);
  const sourceFile = ts.createSourceFile(
    cookieAuthModulePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const forRoot = findCookieAuthForRoot(sourceFile);

  if (!forRoot || forRoot.parameters.length !== 3) {
    throw new Error(
      'Passport cookie preset contract failed: CookieAuthModule.forRoot must accept config, passportOptions, and additionalStrategies.',
    );
  }

  const passportOptionsParameter = forRoot.parameters[1]?.name.getText(sourceFile);
  const additionalStrategiesParameter = forRoot.parameters[2]?.name.getText(sourceFile);

  if (!passportOptionsParameter || !additionalStrategiesParameter) {
    throw new Error(
      'Passport cookie preset contract failed: CookieAuthModule.forRoot composition parameters are missing.',
    );
  }

  const registrations = findPassportRegistrationsInReturnedModuleImports(forRoot, sourceFile);

  if (registrations.length !== 1 || registrations[0].arguments.length !== 2) {
    throw new Error(
      `Passport cookie preset contract failed: CookieAuthModule.forRoot must register exactly one PassportModule.forRoot(...) in returned defineModule imports; found ${registrations.length}.`,
    );
  }

  const [options, strategies] = registrations[0].arguments;

  if (!hasDefaultStrategySpread(options, passportOptionsParameter)) {
    throw new Error(
      'Passport cookie preset contract failed: Passport defaults must forward passportOptions before applying the cookie default fallback.',
    );
  }

  if (!hasCookieRegistration(strategies) || !hasAdditionalStrategiesSpread(strategies, additionalStrategiesParameter)) {
    throw new Error(
      'Passport cookie preset contract failed: the cookie strategy and additionalStrategies must share one Passport registry.',
    );
  }

  const governanceSource = readText(platformGovernancePath);
  const governanceSourceFile = ts.createSourceFile(
    platformGovernancePath,
    governanceSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );

  if (!hasOneDirectMainPassportCookiePresetGuardInvocation(governanceSourceFile)) {
    throw new Error(
      'Passport cookie preset contract failed: main must invoke enforcePassportCookiePresetContract exactly once as a direct active statement.',
    );
  }
}
