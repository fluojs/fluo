import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fetchHandlerSourcePath = 'packages/platform-deno/src/fetch-handler.ts';
const adapterSourcePath = 'packages/platform-deno/src/adapter.ts';
const governedDocuments = [
  ['packages/platform-deno/README.md', 'en'],
  ['packages/platform-deno/README.ko.md', 'ko'],
  ['docs/reference/package-surface.md', 'en'],
  ['docs/reference/package-surface.ko.md', 'ko'],
  ['docs/getting-started/migrate-from-nestjs.md', 'en'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', 'ko'],
  ['docs/CONTEXT.md', 'en'],
  ['docs/CONTEXT.ko.md', 'ko'],
  ['book/intermediate/ch23-deno.md', 'en'],
  ['book/intermediate/ch23-deno.ko.md', 'ko'],
  ['apps/docs/content/docs/guides/runtime-adapters.mdx', 'en'],
  ['apps/docs/content/docs/guides/runtime-adapters.ko.mdx', 'ko'],
];
const migrationDocuments = [
  ['docs/getting-started/migrate-from-nestjs.md', 'en'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', 'ko'],
];
const contextDocuments = [
  ['docs/CONTEXT.md', 'docs/getting-started/migrate-from-nestjs.md'],
  ['docs/CONTEXT.ko.md', 'docs/getting-started/migrate-from-nestjs.ko.md'],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Deno host-owned lifecycle contract check failed: ${message}`);
  }
}

function parseSource(relativePath, content) {
  const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert(sourceFile.parseDiagnostics.length === 0, `${relativePath} must remain valid TypeScript.`);
  return sourceFile;
}

function staticName(node) {
  const name = node && ts.isComputedPropertyName(node) ? node.expression : node;
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : undefined;
}

function callNames(node) {
  const names = new Set();
  function visit(current) {
    if (ts.isCallExpression(current)) {
      const expression = current.expression;
      if (ts.isIdentifier(expression)) {
        names.add(expression.text);
      } else if (ts.isPropertyAccessExpression(expression)) {
        names.add(expression.name.text);
      } else if (ts.isElementAccessExpression(expression)) {
        const name = staticName(expression.argumentExpression);
        if (name) names.add(name);
      }
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return names;
}

function findFunction(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

function findClassMethod(sourceFile, className, methodName) {
  const classDeclaration = sourceFile.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  return classDeclaration?.members.find(
    (member) => ts.isMethodDeclaration(member) && staticName(member.name) === methodName,
  );
}

function enforceSourceOwnership(readText) {
  const fetchSource = parseSource(fetchHandlerSourcePath, readText(fetchHandlerSourcePath));
  const options = fetchSource.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === 'CreateDenoFetchHandlerOptions',
  );
  assert(options, `${fetchHandlerSourcePath} must declare CreateDenoFetchHandlerOptions.`);
  const optionNames = new Set(options.members.map((member) => staticName(member.name)).filter(Boolean));
  const missingRequestOptions = ['dispatcher', 'maxBodySize', 'multipart', 'rawBody'].filter(
    (name) => !optionNames.has(name),
  );
  assert(
    missingRequestOptions.length === 0,
    `${fetchHandlerSourcePath} must retain dispatcher and shared Web request parsing options; missing ${missingRequestOptions.join(', ')}.`,
  );
  const lifecycleOptions = [...optionNames].filter((name) =>
    /server|serve|shutdown|signal|websocket|upgrade/iu.test(name),
  );
  assert(
    lifecycleOptions.length === 0,
    `${fetchHandlerSourcePath} must not expose server, shutdown, signal, or websocket ownership options.`,
  );

  const createHandler = findFunction(fetchSource, 'createDenoFetchHandler');
  assert(createHandler?.body, `${fetchHandlerSourcePath} must export createDenoFetchHandler(...).`);
  const handlerCalls = callNames(createHandler);
  assert(handlerCalls.has('dispatchWebRequest'), 'createDenoFetchHandler(...) must dispatch through the shared Web request path.');
  for (const forbiddenCall of ['serve', 'shutdown', 'addSignalListener', 'removeSignalListener', 'upgradeWebSocket']) {
    assert(!handlerCalls.has(forbiddenCall), `createDenoFetchHandler(...) must not call ${forbiddenCall}(...).`);
  }

  const adapterSource = parseSource(adapterSourcePath, readText(adapterSourcePath));
  const managedMethods = [
    ['listen', ['resolveServe', 'serve']],
    ['close', ['closeDenoServerWithDrain']],
    ['handle', ['resolveUpgradeWebSocket']],
  ];
  for (const [methodName, requiredCalls] of managedMethods) {
    const method = findClassMethod(adapterSource, 'DenoHttpApplicationAdapter', methodName);
    assert(method?.body, `${adapterSourcePath} must keep managed ${methodName}() lifecycle ownership.`);
    const calls = callNames(method);
    for (const requiredCall of requiredCalls) {
      assert(calls.has(requiredCall), `${adapterSourcePath} ${methodName}() must call ${requiredCall}(...).`);
    }
  }
  const runApplication = findFunction(adapterSource, 'runDenoApplication');
  assert(runApplication?.body, `${adapterSourcePath} must export runDenoApplication(...).`);
  const runCalls = callNames(runApplication);
  assert(runCalls.has('runHttpAdapterApplication'), 'runDenoApplication(...) must use the managed HTTP adapter runner.');
  assert(
    runCalls.has('createDenoShutdownSignalRegistration'),
    'runDenoApplication(...) must retain managed shutdown signal registration.',
  );
}

function clauses(content) {
  return content
    .split(/(?<=[.!?;。！？；])\s+|\n+/u)
    .map((clause) => clause.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

function contradictionMessage(content, locale) {
  const patterns = locale === 'en'
    ? {
        handlerSubject: /\b(?:it|the handler|this handler|the function|this function)\b/iu,
        hostSubject: /\b(?:(?:surrounding|external|caller-owned|application-owned)\s+hosts?|hosts?\b(?!-owned))/iu,
        negative: /\b(?:cannot|does not|do not|never|no|not|without)\b/iu,
        seams: [
          ['server startup', /\b(?:starts?|opens?|runs?|owns?)\b[^.!?;]*(?:server|Deno\.serve)/iu],
          ['signal handlers', /\b(?:installs?|registers?|wires?|handles?|owns?)\b[^.!?;]*signals?\b/iu],
          ['shutdown', /\b(?:owns?|performs?|coordinates?|handles?|manages?)\b[^.!?;]*shutdown\b/iu],
          ['websocket upgrades', /\b(?:automatically\s+)?(?:performs?|handles?|owns?|upgrades?)\b[^.!?;]*websocket/iu],
        ],
      }
    : {
        handlerSubject: /(?:이|해당)\s*(?:handler|함수|경로)|(?:handler|함수|경로)(?:가|는|은|이)/u,
        hostSubject: /(?:주변|외부|caller-owned|application-owned)?\s*host\b(?!-owned)/u,
        negative: /(?:않|없|아니|못|불가|지원하지|수행하지|시작하지|설치하지|소유하지)/u,
        seams: [
          ['server startup', /(?:server|Deno\.serve)[^.!?;。！？；]*(?:시작|실행|소유)|(?:시작|실행|소유)[^.!?;。！？；]*(?:server|Deno\.serve)/u],
          ['signal handlers', /(?:signal|시그널)[^.!?;。！？；]*(?:설치|등록|연결|처리|소유)|(?:설치|등록|연결|처리|소유)[^.!?;。！？；]*(?:signal|시그널)/u],
          ['shutdown', /shutdown[^.!?;。！？；]*(?:소유|수행|조율|처리|관리)|(?:소유|수행|조율|처리|관리)[^.!?;。！？；]*shutdown/u],
          ['websocket upgrades', /websocket[^.!?;。！？；]*(?:자동|upgrade|업그레이드|소유|처리|수행)|(?:자동|upgrade|업그레이드|소유|처리|수행)[^.!?;。！？；]*websocket/u],
        ],
      };

  for (const clause of clauses(content)) {
    const handlerStart = clause.indexOf('createDenoFetchHandler(...)');
    if (handlerStart === -1) continue;
    const propositions = clause.slice(handlerStart).split(
      /(?:,\s*|\s+)(?:and|but|however|yet)\s+|(?<=지만)\s*|(?<=않으며)\s*|(?<=않고)\s*/iu,
    );
    let owner = 'handler';
    for (const proposition of propositions) {
      if (patterns.handlerSubject.test(proposition)) owner = 'handler';
      if (patterns.hostSubject.test(proposition)) owner = 'host';
      if (patterns.negative.test(proposition) || owner === 'host') continue;
      for (const [seam, pattern] of patterns.seams) {
        if (pattern.test(proposition)) return `must not claim that createDenoFetchHandler(...) owns ${seam}.`;
      }
    }
  }
  return undefined;
}

function enforceMigrationGuidance(readText) {
  for (const [relativePath, locale] of migrationDocuments) {
    const content = readText(relativePath);
    const migrationLines = content.split('\n');
    const handlerGuidance = migrationLines
      .filter((line) => line.includes('createDenoFetchHandler(...)'))
      .join(' ');
    const managedGuidance = migrationLines
      .filter((line) => line.includes('runDenoApplication(...)') && line.includes('app.listen()'))
      .join(' ');
    const lifecycleTerms = locale === 'en'
      ? [/server|Deno\.serve/iu, /shutdown/iu, /signal/iu, /websocket/iu]
      : [/server|Deno\.serve/iu, /shutdown/iu, /signal/iu, /websocket/iu];
    assert(
      managedGuidance.length > 0 && lifecycleTerms.every((pattern) => pattern.test(`${managedGuidance} ${handlerGuidance}`)),
      `${relativePath} must map managed and host-owned Deno lifecycle ownership across startup, shutdown, signals, and websocket upgrades.`,
    );
    assert(
      handlerGuidance.length > 0 && (locale === 'en' ? /does not|never/iu : /않|없|아니/u).test(handlerGuidance),
      `${relativePath} must state that createDenoFetchHandler(...) does not own the host lifecycle.`,
    );
  }

  for (const [relativePath, migrationPath] of contextDocuments) {
    const content = readText(relativePath);
    const denoContext = content
      .split('\n')
      .filter((line) => line.includes('createDenoFetchHandler(...)'))
      .join(' ');
    assert(
      denoContext.includes(migrationPath),
      `${relativePath} must link the Deno lifecycle contract to ${migrationPath}.`,
    );
  }
}

export function enforceDenoHostOwnedLifecycleContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  enforceSourceOwnership(readText);
  for (const [relativePath, locale] of governedDocuments) {
    const contradiction = contradictionMessage(readText(relativePath), locale);
    assert(!contradiction, `${relativePath} ${contradiction ?? ''}`);
  }
  enforceMigrationGuidance(readText);
}
