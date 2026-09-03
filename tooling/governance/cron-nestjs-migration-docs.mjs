import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const cronNestjsMigrationPropositions = [
  'timezone-mapping',
  'wait-for-completion',
  'unsupported-options',
  'absolute-time',
  'named-interval-timeout',
  'async-configuration',
  'global-visibility',
  'category-switches',
];

export const cronNestjsMigrationDocumentationSurfaces = [
  'packages/cron/README.md',
  'packages/cron/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  'book/intermediate/ch12-cron.md',
  'book/intermediate/ch12-cron.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
];

export const cronNestjsMigrationVisibleGuidance = {
  en: {
    'timezone-mapping': '`timeZone` maps to `timezone`; `CronTaskOptions.timezone` is a string.',
    'wait-for-completion': '`protect: true` prevents overlapping Croner invocations, and `CronLifecycleService` rejects a tick while its task is running.',
    'unsupported-options': 'NestJS scheduler options other than the documented fluo options are unsupported.',
    'absolute-time': '`@Cron` accepts a cron-expression string only; `Date` and `DateTime` overloads are unsupported.',
    'named-interval-timeout': '`@Interval(ms, options)` and `@Timeout(ms, options)` accept milliseconds and optional named task options.',
    'async-configuration': '`CronModule.forRoot(...)` is synchronous; resolve async configuration before calling it.',
    'global-visibility': '`CronModule.forRoot(...)` is local by default; pass `global: true` explicitly when needed.',
    'category-switches': '`cronJobs`, `intervals`, and `timeouts` category switches are unsupported.',
  },
  ko: {
    'timezone-mapping': '`timeZone`은 `timezone`으로 매핑되며 `CronTaskOptions.timezone`은 문자열입니다.',
    'wait-for-completion': '`protect: true`가 Croner 호출의 중복을 막고 `CronLifecycleService`는 작업 실행 중 tick을 거부합니다.',
    'unsupported-options': '문서화된 fluo 옵션 외 NestJS scheduler 옵션은 지원되지 않습니다.',
    'absolute-time': '`@Cron`은 cron-expression 문자열만 받고 `Date`와 `DateTime` overload는 지원되지 않습니다.',
    'named-interval-timeout': '`@Interval(ms, options)`와 `@Timeout(ms, options)`는 millisecond와 선택적 named task option을 받습니다.',
    'async-configuration': '`CronModule.forRoot(...)`는 동기식이며 async configuration은 호출 전에 해석합니다.',
    'global-visibility': '`CronModule.forRoot(...)`는 기본적으로 local이고 필요할 때 `global: true`를 명시합니다.',
    'category-switches': '`cronJobs`, `intervals`, `timeouts` category switch는 지원되지 않습니다.',
  },
};

function fail(proposition, detail) {
  throw new Error(`Platform consistency governance check failed: source contract ${proposition} ${detail}.`);
}

function parseSource(relativePath, readText) {
  const source = ts.createSourceFile(relativePath, readText(relativePath), ts.ScriptTarget.Latest, true);

  if (source.parseDiagnostics.length > 0) {
    fail('source-structure', `in ${relativePath} does not parse as TypeScript`);
  }

  return source;
}

function declarationName(node) {
  return node.name?.getText();
}

function findDeclaration(source, predicate, proposition, relativePath, description) {
  const declaration = source.statements.find(predicate);

  if (!declaration) {
    fail(proposition, `in ${relativePath} must declare ${description}`);
  }

  return declaration;
}

function propertyName(member) {
  return member.name?.getText();
}

function assertPropertyNames(declaration, expectedNames, proposition, description) {
  const names = declaration.members.map(propertyName).sort();
  const expected = [...expectedNames].sort();

  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    fail(proposition, `${description} must expose exactly ${expected.join(', ')}`);
  }
}

function typeText(node) {
  return node?.getText().replace(/\s+/g, ' ');
}

function assertFunctionSignature(source, name, parameters, returnType, proposition) {
  const declarations = source.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && declarationName(statement) === name,
  );

  if (declarations.length !== 1 || !declarations[0].body) {
    fail(proposition, `must declare exactly one implemented ${name} function`);
  }

  const declaration = declarations[0];

  if (declaration.parameters.length !== parameters.length || typeText(declaration.type) !== returnType) {
    fail(proposition, `${name} must keep its documented signature`);
  }

  for (const [index, expected] of parameters.entries()) {
    const parameter = declaration.parameters[index];
    const hasEmptyObjectDefault = parameter.initializer?.getText() === '{}';

    if (
      parameter.name.getText() !== expected.name
      || typeText(parameter.type) !== expected.type
      || hasEmptyObjectDefault !== expected.hasEmptyObjectDefault
    ) {
      fail(proposition, `${name} parameter ${index + 1} must keep its documented shape`);
    }
  }
}

function propertyAccessMatches(node, root, properties) {
  let current = node;

  for (const property of [...properties].reverse()) {
    if (!ts.isPropertyAccessExpression(current) || current.name.text !== property) {
      return false;
    }

    current = current.expression;
  }

  return root === 'this' ? current.kind === ts.SyntaxKind.ThisKeyword : ts.isIdentifier(current) && current.text === root;
}

function containsNode(node, predicate) {
  if (predicate(node)) {
    return true;
  }

  return ts.forEachChild(node, (child) => containsNode(child, predicate)) ?? false;
}

function isRunningAssignment(node, value) {
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && propertyAccessMatches(node.left, 'taskState', ['running'])
    && node.right.kind === (value ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword);
}

function assertNoOverlapSemantics(readText) {
  const source = parseSource('packages/cron/src/service.ts', readText);
  const service = findDeclaration(
    source,
    (statement) => ts.isClassDeclaration(statement) && declarationName(statement) === 'CronLifecycleService',
    'wait-for-completion',
    'packages/cron/src/service.ts',
    'CronLifecycleService',
  );
  const scheduledHandle = service.members.find(
    (member) => ts.isMethodDeclaration(member) && declarationName(member) === 'createScheduledHandle',
  );
  const taskTick = service.members.find(
    (member) => ts.isMethodDeclaration(member) && declarationName(member) === 'handleTaskTick',
  );

  if (!scheduledHandle?.body || !taskTick?.body) {
    fail('wait-for-completion', 'must implement CronLifecycleService scheduling and tick admission');
  }

  const passesProtectTrue = containsNode(
    scheduledHandle.body,
    (node) => ts.isCallExpression(node)
      && propertyAccessMatches(node.expression, 'this', ['options', 'scheduler'])
      && ts.isObjectLiteralExpression(node.arguments[1])
      && node.arguments[1].properties.some(
        (property) => ts.isPropertyAssignment(property)
          && propertyName(property) === 'protect'
          && property.initializer.kind === ts.SyntaxKind.TrueKeyword,
      ),
  );

  if (!passesProtectTrue) {
    fail('wait-for-completion', 'must pass literal protect: true to the cron scheduler');
  }

  const hasRunningAdmissionGuard = containsNode(
    taskTick.body,
    (node) => ts.isIfStatement(node)
      && containsNode(node.expression, (expression) => propertyAccessMatches(expression, 'taskState', ['running']))
      && containsNode(node.thenStatement, ts.isReturnStatement),
  );
  const marksTaskRunning = containsNode(taskTick.body, (node) => isRunningAssignment(node, true));
  const clearsTaskRunningInFinally = containsNode(
    taskTick.body,
    (node) => ts.isTryStatement(node)
      && node.finallyBlock !== undefined
      && containsNode(node.finallyBlock, (child) => isRunningAssignment(child, false)),
  );

  if (!hasRunningAdmissionGuard || !marksTaskRunning || !clearsTaskRunningInFinally) {
    fail('wait-for-completion', 'must reject running tasks and reset their running state in finally');
  }
}

function assertSourceContracts(readText) {
  const types = parseSource('packages/cron/src/types.ts', readText);
  const decorators = parseSource('packages/cron/src/decorators.ts', readText);
  const module = parseSource('packages/cron/src/module.ts', readText);
  const cronTaskOptions = findDeclaration(
    types,
    (statement) => ts.isInterfaceDeclaration(statement) && declarationName(statement) === 'CronTaskOptions',
    'timezone-mapping',
    'packages/cron/src/types.ts',
    'CronTaskOptions',
  );
  const timezone = cronTaskOptions.members.find((member) => propertyName(member) === 'timezone');

  if (!timezone || typeText(timezone.type) !== 'string') {
    fail('timezone-mapping', 'must expose CronTaskOptions.timezone as a string');
  }

  const schedulingTaskOptions = findDeclaration(
    types,
    (statement) => ts.isInterfaceDeclaration(statement) && declarationName(statement) === 'SchedulingTaskOptions',
    'unsupported-options',
    'packages/cron/src/types.ts',
    'SchedulingTaskOptions',
  );

  assertPropertyNames(cronTaskOptions, ['timezone'], 'unsupported-options', 'CronTaskOptions');
  assertPropertyNames(
    schedulingTaskOptions,
    ['afterRun', 'beforeRun', 'distributed', 'key', 'lockTtlMs', 'name', 'onError', 'onSuccess'],
    'unsupported-options',
    'SchedulingTaskOptions',
  );

  assertFunctionSignature(
    decorators,
    'Cron',
    [
      { name: 'expression', type: 'string', hasEmptyObjectDefault: false },
      { name: 'options', type: 'CronTaskOptions', hasEmptyObjectDefault: true },
    ],
    'MethodDecoratorLike',
    'absolute-time',
  );
  assertFunctionSignature(
    decorators,
    'Interval',
    [
      { name: 'ms', type: 'number', hasEmptyObjectDefault: false },
      { name: 'options', type: 'IntervalTaskOptions', hasEmptyObjectDefault: true },
    ],
    'MethodDecoratorLike',
    'named-interval-timeout',
  );
  assertFunctionSignature(
    decorators,
    'Timeout',
    [
      { name: 'ms', type: 'number', hasEmptyObjectDefault: false },
      { name: 'options', type: 'TimeoutTaskOptions', hasEmptyObjectDefault: true },
    ],
    'MethodDecoratorLike',
    'named-interval-timeout',
  );

  const cronModule = findDeclaration(
    module,
    (statement) => ts.isClassDeclaration(statement) && declarationName(statement) === 'CronModule',
    'async-configuration',
    'packages/cron/src/module.ts',
    'CronModule',
  );
  const moduleMethods = cronModule.members.filter(ts.isMethodDeclaration);
  const forRoot = moduleMethods.find((member) => declarationName(member) === 'forRoot');

  if (
    !forRoot?.body
    || forRoot.parameters.length !== 1
    || forRoot.parameters[0].name.getText() !== 'options'
    || typeText(forRoot.parameters[0].type) !== 'CronModuleOptions'
    || forRoot.parameters[0].initializer?.getText() !== '{}'
    || typeText(forRoot.type) !== 'ModuleType'
    || moduleMethods.some((member) => declarationName(member) === 'forRootAsync')
  ) {
    fail('async-configuration', 'must expose synchronous CronModule.forRoot only');
  }

  const defineModuleCall = forRoot.body.statements
    .filter(ts.isReturnStatement)
    .map((statement) => statement.expression)
    .find((expression) => ts.isCallExpression(expression) && expression.expression.getText() === 'defineModule');
  const moduleDefinition = ts.isCallExpression(defineModuleCall) && ts.isObjectLiteralExpression(defineModuleCall.arguments[1])
    ? defineModuleCall.arguments[1]
    : undefined;
  const globalOption = moduleDefinition?.properties.find(
    (property) => ts.isPropertyAssignment(property) && propertyName(property) === 'global',
  );

  if (
    !globalOption
    || !ts.isPropertyAssignment(globalOption)
    || !ts.isBinaryExpression(globalOption.initializer)
    || globalOption.initializer.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
    || !propertyAccessMatches(globalOption.initializer.left, 'options', ['global'])
    || globalOption.initializer.right.kind !== ts.SyntaxKind.FalseKeyword
  ) {
    fail('global-visibility', 'must pass global: options.global ?? false to defineModule');
  }

  const taskKind = findDeclaration(
    types,
    (statement) => ts.isTypeAliasDeclaration(statement) && declarationName(statement) === 'SchedulingTaskKind',
    'category-switches',
    'packages/cron/src/types.ts',
    'SchedulingTaskKind',
  );
  const categoryNames = ts.isUnionTypeNode(taskKind.type)
    ? taskKind.type.types.map((member) => member.getText().replaceAll("'", '')).sort()
    : [];

  if (categoryNames.join(',') !== 'cron,interval,timeout') {
    fail('category-switches', 'must keep exactly cron, interval, and timeout task kinds');
  }

  const moduleOptions = findDeclaration(
    types,
    (statement) => ts.isInterfaceDeclaration(statement) && declarationName(statement) === 'CronModuleOptions',
    'category-switches',
    'packages/cron/src/types.ts',
    'CronModuleOptions',
  );

  assertPropertyNames(
    moduleOptions,
    ['distributed', 'global', 'scheduler', 'shutdown'],
    'category-switches',
    'CronModuleOptions',
  );

  assertNoOverlapSemantics(readText);
}

export const cronNestjsMigrationOverlapProseSurfaces = [
  'packages/cron/README.md',
  'packages/cron/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  'book/intermediate/ch12-cron.md',
  'book/intermediate/ch12-cron.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
];

export const cronNestjsMigrationOverlapProseClauses = {
  en: [
    { name: 'no-overlap-option', pattern: /no `?waitForCompletion`?|not carry `?waitForCompletion`?|`?waitForCompletion`? (?:is omitted|has no (?:direct )?fluo option)|(?:Do not (?:copy|carry)) `?waitForCompletion`?/i },
    { name: 'skips-overlapping-tick', pattern: /(?:skip(?:s|ped)?|skipping)[^.]*\b(?:tick|run)\b|\b(?:tick|run)\b[^.]*(?:skip(?:s|ped)?|skipping)/i },
    { name: 'rejects-queueing', pattern: /(?:instead of|rather than|not) queue(?:ing|d)?|queue(?:ing|d)?[^.]*(?:instead|rather than)/i },
    { name: 'application-owned-overlap-alternative', pattern: /application-owned queue|queue or worker/i },
  ],
  ko: [
    { name: 'no-overlap-option', pattern: /`?waitForCompletion`?[^.]*(?:없|생략|옮기지|복사하지)/ },
    { name: 'skips-overlapping-tick', pattern: /tick[^.]*건너/ },
    { name: 'rejects-queueing', pattern: /queue(?:되)?[^.]*않|queue하지\s*않/ },
    { name: 'application-owned-overlap-alternative', pattern: /application-owned queue|queue(?:나|이나)\s*worker/ },
  ],
};

function visibleRuleRow(proposition, rule) {
  return `| \`${proposition}\` | ${rule} |`;
}

function assertOverlapProse(relativePath, visibleContent, locale) {
  for (const clause of cronNestjsMigrationOverlapProseClauses[locale]) {
    if (!clause.pattern.test(visibleContent)) {
      throw new Error(
        `Platform consistency governance check failed: ${relativePath} must visibly explain the wait-for-completion migration semantics clause ${clause.name}.`,
      );
    }
  }
}

function assertDocumentationContracts(readText) {
  for (const relativePath of cronNestjsMigrationDocumentationSurfaces) {
    const content = readText(relativePath);
    const visibleContent = content.replaceAll(/<!--[\s\S]*?-->/g, '');
    const locale = relativePath.endsWith('.ko.md') ? 'ko' : 'en';

    for (const proposition of cronNestjsMigrationPropositions) {
      const marker = `<!-- fluo:cron-nestjs-migration: ${proposition} -->`;

      if (!content.includes(marker)) {
        throw new Error(
          `Platform consistency governance check failed: ${relativePath} must declare the @nestjs/schedule migration proposition ${proposition}.`,
        );
      }

      if (!visibleContent.includes(visibleRuleRow(proposition, cronNestjsMigrationVisibleGuidance[locale][proposition]))) {
        throw new Error(
          `Platform consistency governance check failed: ${relativePath} must visibly state the @nestjs/schedule migration proposition ${proposition}.`,
        );
      }
    }

    if (cronNestjsMigrationOverlapProseSurfaces.includes(relativePath)) {
      assertOverlapProse(relativePath, visibleContent, locale);
    }
  }
}

export function enforceCronNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  assertSourceContracts(readText);
  assertDocumentationContracts(readText);
}
