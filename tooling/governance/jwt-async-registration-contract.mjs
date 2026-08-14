import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const governedDocuments = [
  ['packages/jwt/README.md', 'en'],
  ['packages/jwt/README.ko.md', 'ko'],
  ['docs/getting-started/migrate-from-nestjs.md', 'en'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', 'ko'],
  ['book/beginner/ch14-jwt.md', 'en'],
  ['book/beginner/ch14-jwt.ko.md', 'ko'],
  ['docs/CONTEXT.md', 'en'],
  ['docs/CONTEXT.ko.md', 'ko'],
];

function fail(relativePath, message) {
  throw new Error(`JWT async registration contract check failed: ${relativePath} ${message}.`);
}

function assert(condition, relativePath, message) {
  if (!condition) {
    fail(relativePath, message);
  }
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

function propertyName(node) {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return node.getText();
}

function propertyInitializer(object, name) {
  const property = object.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name);
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

function enforceSourceContract(readText) {
  const coreTypesPath = 'packages/core/src/types.ts';
  const coreTypes = parseSource(coreTypesPath, readText(coreTypesPath));
  const asyncOptions = coreTypes.statements.find((statement) =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === 'AsyncModuleOptions');
  assert(asyncOptions, coreTypesPath, 'must declare AsyncModuleOptions<T>');

  const optionNames = asyncOptions.members
    .map((member) => propertyName(member.name))
    .filter((name) => name !== undefined)
    .sort();
  assert(
    optionNames.join(',') === 'inject,useFactory',
    coreTypesPath,
    `must keep AsyncModuleOptions<T> limited to inject and useFactory; found ${optionNames.join(', ')}`,
  );
  const useFactoryMember = asyncOptions.members.find((member) => propertyName(member.name) === 'useFactory');
  assert(
    useFactoryMember?.type?.getText().includes('MaybePromise<T>'),
    coreTypesPath,
    'must keep useFactory responsible for returning the final typed module options',
  );

  const jwtModulePath = 'packages/jwt/src/module.ts';
  const jwtModuleSource = parseSource(jwtModulePath, readText(jwtModulePath));
  const jwtModule = jwtModuleSource.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'JwtModule');
  const forRootAsync = jwtModule?.members.find((member) =>
    ts.isMethodDeclaration(member) && propertyName(member.name) === 'forRootAsync');
  assert(forRootAsync && ts.isMethodDeclaration(forRootAsync), jwtModulePath, 'must declare JwtModule.forRootAsync(...)');

  const optionsParameter = forRootAsync.parameters[0];
  assert(
    optionsParameter?.type?.getText().includes('AsyncModuleOptions<JwtVerifierOptions>'),
    jwtModulePath,
    'must type forRootAsync(...) with AsyncModuleOptions<JwtVerifierOptions>',
  );

  const accessedOptionNames = new Set();
  function visit(node) {
    if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'options') {
      accessedOptionNames.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(forRootAsync);
  const accessed = [...accessedOptionNames].sort();
  assert(
    accessed.join(',') === 'global,inject,useFactory',
    jwtModulePath,
    `must read only inject/useFactory plus the separate global visibility option; found ${accessed.join(', ')}`,
  );

  const returnStatement = forRootAsync.body?.statements.find(ts.isReturnStatement);
  const createModuleCall = returnStatement?.expression && ts.isCallExpression(returnStatement.expression)
    ? returnStatement.expression
    : undefined;
  const optionsProvider = createModuleCall?.arguments[0];
  assert(
    createModuleCall?.expression.getText() === 'this.createModule' &&
      optionsProvider !== undefined && ts.isObjectLiteralExpression(optionsProvider),
    jwtModulePath,
    'must pass one explicit options provider into createModule(...)',
  );
  assert(
    propertyInitializer(optionsProvider, 'inject')?.getText() === 'options.inject',
    jwtModulePath,
    'must forward only pre-registered inject tokens to the JWT options provider',
  );
  assert(
    propertyInitializer(optionsProvider, 'useFactory')?.getText() === 'options.useFactory',
    jwtModulePath,
    'must forward useFactory as the final JWT options factory',
  );
}

function clauses(content) {
  return content
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((clause) => clause.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

function hasAll(value, patterns) {
  return patterns.every((pattern) => pattern.test(value));
}

function requiredGuidance(content, locale) {
  const documentClauses = clauses(content);
  const localePatterns = locale === 'en'
    ? {
        graphTiming: /\b(?:already|before|first|pre-register\w*)\b/iu,
        negative: /\b(?:does not|do not|not accepted|not part|no|never|unsupported|outside)\b/iu,
        returnAction: /\breturns?\b/iu,
      }
    : {
        graphTiming: /(?:먼저|사전에|이미|전에)/u,
        negative: /(?:지원하지|허용하지|받지|포함되지|아니|없|금지|거부)/u,
        returnAction: /(?:반환)/u,
      };
  const actor = /JwtModule\.forRootAsync/u;

  return {
    discoveryBoundary: documentClauses.some((clause) => hasAll(clause, [
      actor,
      /(?:implicit|automatic|암묵적|자동)/iu,
      /(?:module|provider)/iu,
      /(?:discover|discovery|scan|탐색|발견)/iu,
      localePatterns.negative,
    ])),
    finalOptions: documentClauses.some((clause) => hasAll(clause, [
      actor,
      /(?:useFactory|factory)/u,
      /final JWT options?/iu,
      localePatterns.returnAction,
    ])),
    graphRegistration: documentClauses.some((clause) => hasAll(clause, [
      actor,
      /(?:dependencies?|providers?|의존성|provider)/iu,
      /application (?:module )?graph/iu,
      /(?:register|등록)/iu,
      localePatterns.graphTiming,
    ])),
    rejectedNestjsFields: documentClauses.some((clause) => hasAll(clause, [
      actor,
      /imports/u,
      /useClass/u,
      /useExisting/u,
      localePatterns.negative,
    ])),
    supportedShape: documentClauses.some((clause) => hasAll(clause, [actor, /inject/u, /useFactory/u])),
  };
}

function contradictionMessage(content, locale) {
  const languagePatterns = locale === 'en'
    ? {
        negative: /\b(?:cannot|does not|do not|never|no|not accepted|not supported|unsupported|outside)\b/iu,
        positive: /\b(?:accept(?:s|ed)?|allows?|supports?|permits?|takes?|valid|available|can use|may use|ignored)\b/iu,
      }
    : {
        negative: /(?:지원하지|허용하지|받지|사용할 수 없|포함되지|아니|없|금지|거부)/u,
        positive: /(?:지원|허용|받는다|사용할 수 있|유효|무시)/u,
      };
  const actor = /(?:JwtModule\.forRootAsync|fluo JWT async registration|JWT async registration)/iu;
  const forbiddenField = /(?:imports|useClass|useExisting)/u;
  const discoveryMode = /(?:implicit|automatic|암묵적|자동)/iu;
  const discoveryTarget = /(?:module|provider)/iu;
  const discoveryAction = /(?:discover|discovery|scan|탐색|발견)/iu;

  for (const clause of clauses(content)) {
    if (!actor.test(clause)) {
      continue;
    }
    const connectiveParts = clause.split(
      /(?:,\s*|\s+)(?:and|but|however|yet|while)\s+|(?:하지만|그러나|반면|지만|않으며)[,\s]*/iu,
    );
    const propositions = connectiveParts.flatMap((proposition) =>
      languagePatterns.negative.test(proposition) && languagePatterns.positive.test(proposition)
        ? proposition.split(/,\s*/u)
        : [proposition]);

    for (const proposition of propositions) {
      const isNegative = languagePatterns.negative.test(proposition);
      if (forbiddenField.test(proposition) && languagePatterns.positive.test(proposition) && !isNegative) {
        return 'must not claim that NestJS imports/useClass/useExisting fields are accepted, usable, or ignored.';
      }
      if (
        discoveryMode.test(proposition) &&
        discoveryTarget.test(proposition) &&
        discoveryAction.test(proposition) &&
        !isNegative
      ) {
        return 'must not claim implicit module or provider discovery.';
      }
    }
  }

  return undefined;
}

export function enforceJwtAsyncRegistrationContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceSourceContract(readText);

  for (const [relativePath, locale] of governedDocuments) {
    const content = readText(relativePath);
    const guidance = requiredGuidance(content, locale);
    const missing = Object.entries(guidance)
      .filter(([, present]) => !present)
      .map(([name]) => name);
    assert(
      missing.length === 0,
      relativePath,
      `must document the source-backed injected-factory boundary; missing ${missing.join(', ')}`,
    );
    const contradiction = contradictionMessage(content, locale);
    assert(!contradiction, relativePath, contradiction ?? 'must remain contradiction-free');
  }
}
