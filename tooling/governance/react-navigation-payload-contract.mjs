import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientPath = 'packages/react/src/client/navigation-payload.ts';
const serverPath = 'packages/react/src/page-result.ts';
const transferPath = 'packages/react/src/navigation-payload.ts';
const metadataPath = 'packages/react/src/page-metadata.ts';
const storePath = 'packages/react/src/client/store.ts';
const formStorePath = 'packages/react/src/client/form-store.ts';
const formPath = 'packages/react/src/client/form.ts';
const formTransportPath = 'packages/react/src/client/form-transport.ts';
const experiencePath = 'packages/react/src/client/experience.ts';
const historyPath = 'packages/react/src/client/history.ts';
const providerPath = 'packages/react/src/client/provider.ts';
const dispatchPath = 'packages/http/src/dispatch/dispatch-response-policy.ts';
const mediaType = 'application/vnd.fluo.react-navigation+json;v=2';

function property(object, name) {
  return object?.properties.find((node) =>
    ts.isPropertyAssignment(node) && node.name.getText(object.getSourceFile()) === name)?.initializer;
}

function findNode(root, predicate) {
  if (predicate(root)) {
    return root;
  }
  return ts.forEachChild(root, (child) => findNode(child, predicate));
}

function findNodes(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

export function enforceReactNavigationPayloadContract(
  readText = (path) => readFileSync(resolve(repoRoot, path), 'utf8'),
) {
  const client = ts.createSourceFile(clientPath, readText(clientPath), ts.ScriptTarget.Latest, true);
  const server = ts.createSourceFile(serverPath, readText(serverPath), ts.ScriptTarget.Latest, true);
  const transfer = ts.createSourceFile(transferPath, readText(transferPath), ts.ScriptTarget.Latest, true);
  const metadataSource = ts.createSourceFile(metadataPath, readText(metadataPath), ts.ScriptTarget.Latest, true);
  const store = ts.createSourceFile(storePath, readText(storePath), ts.ScriptTarget.Latest, true);
  const formStore = ts.createSourceFile(formStorePath, readText(formStorePath), ts.ScriptTarget.Latest, true);
  const form = ts.createSourceFile(formPath, readText(formPath), ts.ScriptTarget.Latest, true);
  const formTransport = ts.createSourceFile(formTransportPath, readText(formTransportPath), ts.ScriptTarget.Latest, true);
  const experience = ts.createSourceFile(experiencePath, readText(experiencePath), ts.ScriptTarget.Latest, true);
  const history = ts.createSourceFile(historyPath, readText(historyPath), ts.ScriptTarget.Latest, true);
  const provider = ts.createSourceFile(providerPath, readText(providerPath), ts.ScriptTarget.Latest, true);
  const dispatch = ts.createSourceFile(dispatchPath, readText(dispatchPath), ts.ScriptTarget.Latest, true);
  const clientMediaType = findNode(client, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(client) === 'MEDIA_TYPE');
  const serverMediaType = findNode(server, (node) =>
    ts.isPropertyAssignment(node) && node.name.getText(server) === 'mediaType');
  if (!clientMediaType || !ts.isVariableDeclaration(clientMediaType)
    || !clientMediaType.initializer || !ts.isStringLiteral(clientMediaType.initializer)
    || clientMediaType.initializer.text !== mediaType
    || !serverMediaType || !ts.isPropertyAssignment(serverMediaType)
    || !ts.isStringLiteral(serverMediaType.initializer)
    || serverMediaType.initializer.text !== mediaType) {
    throw new Error('React navigation HTTP and browser media types must agree on protocol version 2.');
  }
  const clientText = client.getFullText();
  const providerText = provider.getFullText();
  const transferText = transfer.getFullText();
  if (!transferText.includes('readonly buildId: string')
    || !clientText.includes("value.version !== 2")
    || !clientText.includes("value.buildId.length === 0")
    || !clientText.includes("payload.buildId !== buildId")
    || !clientText.includes("payload.buildId !== options.buildId")
    || clientText.indexOf("payload.buildId !== options.buildId") > clientText.lastIndexOf('module = await loader()')
    || !providerText.includes('loadReactNavigationDestination(href, modules, { signal, buildId })')
    || !providerText.includes('loadReactNavigationDestination(href, modules, { signal, prefetch: true, buildId })')) {
    throw new Error('React navigation v2 requires a build identity checked before any destination import.');
  }

  const initialTransfer = findNode(transfer, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'createReactInitialNavigationPage');
  const initialLoad = findNode(client, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'loadReactInitialNavigationDestination');
  const serverTransfer = findNode(server, (node) =>
    ts.isCallExpression(node) && node.expression.getText(server) === 'createReactInitialNavigationPage');
  const json = initialTransfer && findNode(initialTransfer, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(transfer) === 'json');
  const escape = json?.initializer;
  const replacement = escape?.arguments?.[1];
  const limit = initialTransfer && findNode(initialTransfer, (node) =>
    ts.isIfStatement(node) && ts.isBinaryExpression(node.expression)
    && node.expression.operatorToken.kind === ts.SyntaxKind.GreaterThanToken
    && ts.isPropertyAccessExpression(node.expression.left)
    && node.expression.left.name.text === 'byteLength');
  const encoded = limit?.expression.left.expression;
  if (!initialTransfer || !initialLoad || !serverTransfer
    || !escape || !ts.isCallExpression(escape)
    || !ts.isPropertyAccessExpression(escape.expression) || escape.expression.name.text !== 'replace'
    || !ts.isCallExpression(escape.expression.expression)
    || escape.expression.expression.expression.getText(transfer) !== 'JSON.stringify'
    || escape.expression.expression.arguments[0]?.getText(transfer) !== 'payload'
    || !ts.isRegularExpressionLiteral(escape.arguments[0])
    || escape.arguments[0].text !== '/[<>&\\u2028\\u2029]/gu'
    || !replacement || !ts.isArrowFunction(replacement)
    || !ts.isTemplateExpression(replacement.body)
    || replacement.body.head.text !== '\\u'
    || replacement.body.templateSpans.length !== 1
    || replacement.body.templateSpans[0].expression.getText(transfer)
      !== "character.charCodeAt(0).toString(16).padStart(4, '0')"
    || !limit || !ts.isIfStatement(limit)
    || !ts.isBinaryExpression(limit.expression.right)
    || limit.expression.right.operatorToken.kind !== ts.SyntaxKind.AsteriskToken
    || limit.expression.right.left.getText(transfer) !== '64'
    || limit.expression.right.right.getText(transfer) !== '1024'
    || !encoded || !ts.isCallExpression(encoded)
    || !ts.isPropertyAccessExpression(encoded.expression) || encoded.expression.name.text !== 'encode'
    || encoded.arguments[0]?.getText(transfer) !== 'json'
    || !ts.isNewExpression(encoded.expression.expression)
    || encoded.expression.expression.expression.getText(transfer) !== 'TextEncoder'
    || !findNode(limit.thenStatement, (node) =>
      ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)
      && node.expression.expression.getText(transfer) === 'RangeError')
    || !findNode(initialLoad, (node) =>
      ts.isCallExpression(node) && node.expression.getText(client) === 'parseNavigationPayload')) {
    throw new Error('React navigation initial document transfer must retain escaping, size bounds and the shared client validator.');
  }

  const payloadType = findNode(transfer, (node) =>
    ts.isTypeAliasDeclaration(node) && node.name.text === 'ReactNavigationPayload');
  const metadataProperty = payloadType && findNode(payloadType, (node) =>
    ts.isPropertySignature(node) && node.name.getText(transfer) === 'metadata');
  const payloadFactory = findNode(transfer, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'createReactNavigationPayload');
  const factoryMetadata = payloadFactory && findNode(payloadFactory, (node) =>
    ts.isConditionalExpression(node) && node.condition.getText(transfer) === 'metadata === undefined'
    && ts.isObjectLiteralExpression(node.whenFalse)
    && node.whenFalse.properties.some((entry) =>
      ts.isShorthandPropertyAssignment(entry) && entry.name.text === 'metadata'));
  const parseMetadata = findNode(metadataSource, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'parseReactPageMetadata');
  const metadataBounds = [
    ['value.title.length', '512'],
    ['value.meta.length', '32'],
    ['value.links.length', '32'],
    ['entry.content.length', '2048'],
    ['entry.href.length', '2048'],
  ];
  const bounded = parseMetadata && metadataBounds.every(([subject, limit]) =>
    findNode(parseMetadata, (node) =>
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken
      && node.left.getText(metadataSource) === subject
      && node.right.getText(metadataSource) === limit));
  const safeLink = parseMetadata && findNode(parseMetadata, (node) =>
    ts.isCallExpression(node) && node.expression.getText(metadataSource) === 'isPageLinkHref'
    && node.arguments[0]?.getText(metadataSource) === 'entry.href');
  const hrefPolicy = findNode(metadataSource, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'isPageLinkHref');
  const sameOriginLink = hrefPolicy && findNode(hrefPolicy, (node) =>
    ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && node.left.getText(metadataSource) === "new URL(href, 'https://fluo.invalid').origin"
    && node.right.getText(metadataSource) === "'https://fluo.invalid'");
  const duplicateGuard = parseMetadata && ['metaKeys', 'linkKeys'].every((name) =>
    findNode(parseMetadata, (node) =>
      ts.isIfStatement(node)
      && findNode(node.expression, (part) => ts.isCallExpression(part)
        && part.expression.getText(metadataSource) === `${name}.has`
        && part.arguments[0]?.getText(metadataSource) === 'identity')
      && findNode(node.thenStatement, (part) =>
        ts.isReturnStatement(part) && part.expression?.getText(metadataSource) === 'undefined')));
  const parsePayload = findNode(client, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'parseNavigationPayload');
  const browserMetadata = parsePayload && findNode(parsePayload, (node) =>
    ts.isCallExpression(node) && node.expression.getText(client) === 'parseReactPageMetadata'
    && node.arguments[0]?.getText(client) === 'value.metadata');
  const rejectInvalidMetadata = parsePayload && findNode(parsePayload, (node) =>
    ts.isIfStatement(node)
    && node.expression.getText(client) === 'value.metadata !== undefined && metadata === undefined'
    && findNode(node.thenStatement, (child) =>
      ts.isReturnStatement(child) && child.expression?.getText(client) === 'undefined'));
  const approvedMetadata = parsePayload && findNode(parsePayload, (node) =>
    ts.isSpreadAssignment(node)
    && ts.isParenthesizedExpression(node.expression)
    && ts.isConditionalExpression(node.expression.expression)
    && node.expression.expression.condition.getText(client) === 'metadata === undefined'
    && ts.isObjectLiteralExpression(node.expression.expression.whenFalse)
    && node.expression.expression.whenFalse.properties.some((entry) =>
      ts.isShorthandPropertyAssignment(entry) && entry.name.text === 'metadata'));
  const serverMetadata = findNode(server, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(server) === 'pageMetadata');
  const resolveMetadata = serverMetadata && findNode(serverMetadata, (node) =>
    ts.isCallExpression(node) && node.expression.getText(server) === 'resolveReactPageMetadata');
  const boundServerMetadata = serverMetadata && findNode(serverMetadata, (node) =>
    ts.isCallExpression(node) && node.expression.getText(server) === 'parseReactPageMetadata'
    && node.arguments[0]?.getText(server) === 'resolved');
  const serverPayloads = findNodes(server, (node) =>
    ts.isCallExpression(node) && node.expression.getText(server) === 'createReactNavigationPayload');
  const initialPayload = serverTransfer && ts.isCallExpression(serverTransfer)
    ? serverTransfer.arguments[0] : undefined;
  const committedMetadata = findNode(store, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'publish'
    && node.arguments[0] && ts.isCallExpression(node.arguments[0])
    && node.arguments[0].expression.getText(store) === 'createSnapshotForHref'
    && node.arguments[0].arguments[2]?.getText(store) === 'result.payload.params'
    && node.arguments[0].arguments[3]?.getText(store) === 'result.payload.metadata');
  if (!metadataProperty || !ts.isPropertySignature(metadataProperty)
    || !metadataProperty.questionToken || metadataProperty.type?.getText(transfer) !== 'ReactPageMetadata'
    || !factoryMetadata || !bounded || !safeLink || !sameOriginLink || !duplicateGuard || !browserMetadata
    || !rejectInvalidMetadata || !approvedMetadata || !resolveMetadata || !boundServerMetadata
    || serverPayloads.length !== 2 || !initialPayload || !ts.isCallExpression(initialPayload)
    || initialPayload !== serverPayloads[0]
    || serverPayloads[0].arguments[4]?.getText(server) !== 'pageMetadata(writerContext.requestContext)'
    || serverPayloads[1].arguments[4]?.getText(server) !== 'pageMetadata(requestContext)'
    || !committedMetadata) {
    throw new Error('React navigation metadata must stay bounded and matched across HTTP, browser validation, and route commit.');
  }

  const fetchCalls = findNodes(client, (node) =>
    ts.isCallExpression(node) && node.expression.getText(client) === 'fetch');
  const fetchOptions = fetchCalls.map((call) => call.arguments[1]);
  if (fetchOptions.length === 0 || fetchOptions.some((options) => {
    const headers = options && ts.isObjectLiteralExpression(options) ? property(options, 'headers') : undefined;
    const accept = headers && ts.isObjectLiteralExpression(headers) ? property(headers, 'Accept') : undefined;
    return !options || !ts.isObjectLiteralExpression(options)
      || !accept || !ts.isIdentifier(accept) || accept.text !== 'MEDIA_TYPE'
      || !['cache:no-store', 'redirect:manual'].every((pair) => {
        const [name, expected] = pair.split(':');
        const value = property(options, name);
        return value && ts.isStringLiteral(value) && value.text === expected;
      });
  })) {
    throw new Error('React navigation requests must retain the explicit media type, no cache, and manual redirects.');
  }
  const credentials = fetchOptions.map((options) => property(options, 'credentials'));
  const firstCredentials = credentials[0];
  if (!firstCredentials || !ts.isConditionalExpression(firstCredentials)
    || firstCredentials.condition.getText(client) !== 'options.prefetch === true'
    || !ts.isStringLiteral(firstCredentials.whenTrue) || firstCredentials.whenTrue.text !== 'omit'
    || !ts.isStringLiteral(firstCredentials.whenFalse) || firstCredentials.whenFalse.text !== 'same-origin') {
    throw new Error('React navigation must use same-origin credentials normally and omit them only for prefetch.');
  }
  if (credentials.slice(1).some((value) => !value || !ts.isStringLiteral(value) || value.text !== 'omit')) {
    throw new Error('React navigation prefetch requests must omit credentials.');
  }
  const ordinaryLoad = findNode(provider, (node) =>
    ts.isPropertyAssignment(node) && node.name.getText(provider) === 'load'
    && node.initializer.getText(provider).includes('loadReactNavigationDestination'));
  const speculativeLoad = findNode(provider, (node) =>
    ts.isPropertyAssignment(node) && node.name.getText(provider) === 'prefetch'
    && node.initializer.getText(provider).includes('loadReactNavigationDestination'));
  const ordinaryOptions = ordinaryLoad && ts.isPropertyAssignment(ordinaryLoad)
    ? findNode(ordinaryLoad.initializer, (node) =>
      ts.isCallExpression(node) && node.expression.getText(provider) === 'loadReactNavigationDestination')
    : undefined;
  const speculativeOptions = speculativeLoad && ts.isPropertyAssignment(speculativeLoad)
    ? findNode(speculativeLoad.initializer, (node) =>
      ts.isCallExpression(node) && node.expression.getText(provider) === 'loadReactNavigationDestination')
    : undefined;
  if (!ordinaryOptions || !ts.isCallExpression(ordinaryOptions)
    || !speculativeOptions || !ts.isCallExpression(speculativeOptions)
    || !ts.isObjectLiteralExpression(ordinaryOptions.arguments[2])
    || property(ordinaryOptions.arguments[2], 'prefetch') !== undefined
    || !ts.isObjectLiteralExpression(speculativeOptions.arguments[2])
    || property(speculativeOptions.arguments[2], 'prefetch')?.kind !== ts.SyntaxKind.TrueKeyword) {
    throw new Error('React navigation prefetch must use a distinct anonymous request, not the credentialed ordinary loader.');
  }
  const freshness = findNode(client, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'prefetchFreshUntil');
  if (!freshness || !findNodes(freshness, (node) =>
    ts.isStringLiteral(node) && node.text === 'X-Fluo-Navigation-Prefetch').length
    || !findNodes(freshness, (node) => ts.isStringLiteral(node) && node.text === 'Cache-Control').length
    || !findNodes(freshness, (node) => ts.isStringLiteral(node) && node.text === 'Vary').length) {
    throw new Error('React navigation prefetch must require an explicit HTTP freshness grant.');
  }
  const prefetchRejection = findNode(client, (node) =>
    ts.isIfStatement(node) && node.expression.getText(client).includes('options.prefetch === true')
    && node.expression.getText(client).includes('response.status !== 200')
    && node.expression.getText(client).includes('freshUntil === undefined'));
  const ordinaryNavigationLoad = findNode(client, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'loadReactNavigationDestination');
  const componentImport = ordinaryNavigationLoad && findNode(ordinaryNavigationLoad, (node) =>
    ts.isCallExpression(node) && node.expression.getText(client) === 'loader');
  if (!prefetchRejection || !componentImport || prefetchRejection.end >= componentImport.pos) {
    throw new Error('React navigation prefetch must reject missing HTTP approval before importing a component.');
  }

  const approvalGuard = findNode(store, (node) =>
    ts.isIfStatement(node) && node.expression.getText(store) === '!result.ok');
  const requests = findNodes(store, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'load');
  const historyWrites = findNodes(store, (node) =>
    ts.isCallExpression(node) && ['browser.pushState', 'browser.replaceState']
      .includes(node.expression.getText(store)));
  const historyRead = findNode(history, (node) =>
    ts.isCallExpression(node) && node.expression.getText(history) === 'handlers.loadAndCommit'
    && node.arguments[2]?.getText(history) === "'back'");
  if (!approvalGuard || !ts.isIfStatement(approvalGuard)
    || !ts.isBlock(approvalGuard.thenStatement)
    || !approvalGuard.thenStatement.statements.some(ts.isReturnStatement)
    || !findNode(approvalGuard.thenStatement, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'browser.assign')
    || requests.length === 0 || requests.some((request) =>
      request.arguments[0]?.getText(store) !== 'destination.href'
      || request.arguments[1]?.getText(store) !== 'controller.signal')
    || historyWrites.length < 2
    || new Set(historyWrites.map((write) => write.expression.getText(store))).size !== 2
    || historyWrites.some((write) => approvalGuard.end >= write.pos) || !historyRead) {
    throw new Error('React navigation must request server approval and handle rejection before history writes, including traversal.');
  }
  if (!findNode(approvalGuard.thenStatement, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'browser.failurePolicy')
    || !findNode(approvalGuard.thenStatement, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'browser.go')
    || !findNode(approvalGuard.thenStatement, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'browser.replace')) {
    throw new Error('React navigation policy must decide before document fallback and preserve history recovery.');
  }
  const refresh = findNode(store, (node) =>
    ts.isMethodDeclaration(node) && node.name.getText(store) === 'refresh');
  const refreshBody = refresh && ts.isMethodDeclaration(refresh) ? refresh.body : undefined;
  const refreshLoad = refreshBody && findNode(refreshBody, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'loadAndCommit');
  const restoreLoad = findNode(store, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'loadAndCommit'
    && node.arguments[0]?.getText(store) === 'nextEnvironment'
    && node.arguments[1]?.getText(store) === 'new URL(nextEnvironment.currentHref())'
    && node.arguments[2]?.getText(store) === "'refresh'");
  const restoreTraversal = refreshBody && findNode(refreshBody, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'browser.go'
    && node.arguments[0]?.getText(store) === 'approvedIndex - restoreFrom');
  const successCommit = findNode(store, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'createElement'
    && node.arguments[0]?.getText(store) === 'result.component');
  if (!refresh || !ts.isMethodDeclaration(refresh)
    || !refreshBody || !refreshLoad || !ts.isCallExpression(refreshLoad)
    || refreshLoad.arguments[0]?.getText(store) !== 'browser'
    || refreshLoad.arguments[1]?.getText(store) !== 'new URL(browser.currentHref())'
    || refreshLoad.arguments[2]?.getText(store) !== "'refresh'"
    || !restoreLoad || !restoreTraversal
    || !findNode(refreshBody, (node) =>
      ts.isBinaryExpression(node) && node.getText(store) === 'toSnapshotUrl(browser.currentHref()) !== snapshot.url')
    || !findNode(refreshBody, (node) =>
      ts.isNewExpression(node) && node.expression.getText(store) === 'URL'
      && node.arguments?.[0]?.getText(store) === 'browser.currentHref()')
    || !findNode(refreshBody, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'discardPrefetches')
    || !findNode(refreshBody, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'cancelPending')
    || !successCommit || successCommit.pos <= approvalGuard.end
    || !findNode(store, (node) =>
      ts.isBinaryExpression(node) && node.getText(store) === 'requestGeneration !== generation')
    || !findNode(store, (node) =>
      ts.isBinaryExpression(node) && node.getText(store) === "type === 'refresh'")) {
    throw new Error('React navigation refresh must request the current URL through fresh generation-guarded HTTP approval.');
  }
  const formApproval = findNode(store, (node) =>
    ts.isMethodDeclaration(node) && node.name.getText(store) === 'approveForm');
  const formRead = formApproval && findNode(formApproval, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'loadAndCommit');
  const formReadType = formApproval && findNode(formApproval, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(store) === 'type');
  if (!formRead || formRead.arguments[0]?.getText(store) !== 'browser'
    || formRead.arguments[1]?.getText(store) !== 'destination'
    || formRead.arguments[2]?.getText(store) !== 'type'
    || formRead.arguments[3]?.getText(store) !== 'undefined'
    || formRead.arguments[4]?.kind !== ts.SyntaxKind.TrueKeyword
    || formReadType?.initializer?.getText(store) !== "followUp === 'refresh' ? 'refresh' : 'push'"
    || !findNode(formApproval, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'cached.clear')
    || !findNode(formApproval, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'discardPrefetches')) {
    throw new Error('React navigation form follow-up must reuse fresh HTTP approval, not a cached or alternate destination path.');
  }
  const sessionBarrier = findNode(store, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(store) === 'applySession');
  const advanceSession = sessionBarrier && findNode(sessionBarrier, (node) =>
    ts.isPrefixUnaryExpression(node) && node.getText(store) === '++sessionGeneration');
  const revokeSnapshot = sessionBarrier && findNode(sessionBarrier, (node) =>
    ts.isBinaryExpression(node) && node.left.getText(store) === 'snapshot'
    && node.right.getText(store).includes('createSnapshotFromHref')
    && node.right.getText(store).includes('session: Object.freeze'));
  const detachPending = sessionBarrier && findNode(sessionBarrier, (node) =>
    ts.isBinaryExpression(node) && node.getText(store) === 'pending = null');
  const abortOld = sessionBarrier && findNode(sessionBarrier, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'oldPending?.controller.abort');
  const formSession = findNode(formStore, (node) =>
    ts.isCallExpression(node) && node.expression.getText(formStore) === 'environment.sessionChanged');
  const formReadAfterSave = findNode(formStore, (node) =>
    ts.isCallExpression(node) && node.expression.getText(formStore) === 'read'
    && node.arguments[0]?.getText(formStore) === 'mutation');
  if (!advanceSession || !revokeSnapshot || !detachPending || !abortOld
    || detachPending.end >= abortOld.pos || revokeSnapshot.end >= abortOld.pos
    || !findNode(sessionBarrier, (node) =>
      ts.isBinaryExpression(node) && node.getText(store) === 'expected !== sessionGeneration')
    || !formSession || !formReadAfterSave || formSession.end >= formReadAfterSave.pos
    || !findNode(store, (node) => ts.isMethodDeclaration(node) && node.name.getText(store) === 'sessionChanged')
    || !findNode(experience, (node) => ts.isConditionalExpression(node)
      && node.condition.getText(experience) === 'revoked')) {
    throw new Error('React navigation session must revoke approval and detach old ownership before abort, policy or form follow-up.');
  }
  const releaseOrigin = findNode(store, (node) =>
    ts.isPropertyAssignment(node) && node.name.getText(store) === 'releaseFormSession');
  const cancelOriginPolicy = releaseOrigin && findNode(releaseOrigin, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'controller?.abort');
  const clearOriginPolicy = releaseOrigin && findNode(releaseOrigin, (node) =>
    ts.isBinaryExpression(node) && node.getText(store) === 'sessionPolicyController = null');
  const postAuth = findNode(store, (node) =>
    ts.isMethodDeclaration(node) && node.name.getText(store) === 'rejectFormAuth');
  if (!cancelOriginPolicy || !clearOriginPolicy || clearOriginPolicy.end >= cancelOriginPolicy.pos
    || !findNode(releaseOrigin, (node) =>
      ts.isBinaryExpression(node) && node.getText(store) === 'sessionPolicyOrigin !== origin')
    || !findNode(postAuth, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'router.refresh')
    || !findNode(formStore, (node) =>
      ts.isCallExpression(node) && node.expression.getText(formStore) === 'Promise.race'
      && node.getText(formStore).includes('continuation')
      && node.getText(formStore).includes('cancellation'))) {
    throw new Error('React navigation session policy cancellation and auth refresh must preserve owned authority and bounded settlement.');
  }
  const adoptedApproval = findNode(store, (node) =>
    ts.isConditionalExpression(node) && node.condition.getText(store).includes('prefetchedResult.ok'));
  if (!adoptedApproval || !ts.isConditionalExpression(adoptedApproval)
    || !adoptedApproval.condition.getText(store).includes('prefetchedResult.prefetchExpiresAt')
    || !adoptedApproval.condition.getText(store).includes('Date.now() < prefetchedResult.prefetchExpiresAt')
    || adoptedApproval.end >= approvalGuard.pos
    || !findNode(store, (node) =>
      ts.isIfStatement(node) && node.expression.getText(store) === '!result.ok')) {
    throw new Error('React navigation prefetch adoption must verify approval and freshness before history writes.');
  }
  const grant = findNode(dispatch, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(dispatch) === 'grantsPrefetch');
  const grantChecks = [];
  const pendingChecks = grant && ts.isVariableDeclaration(grant) && grant.initializer
    ? [grant.initializer] : [];
  while (pendingChecks.length > 0) {
    const check = pendingChecks.pop();
    if (ts.isBinaryExpression(check) && check.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      pendingChecks.push(check.left, check.right);
    } else {
      grantChecks.push(check.getText(dispatch));
    }
  }
  const grantBranch = findNode(dispatch, (node) =>
    ts.isIfStatement(node) && node.expression.getText(dispatch) === 'grantsPrefetch');
  if (![
    'representation.mediaType === NAVIGATION_CONTENT_TYPE',
    "request.method.toUpperCase() === 'GET'",
    "representation.prefetch === 'public'",
    'response.statusCode === 200',
    '!hasIdentityHeader',
    "!hasExistingHeader('set-cookie')",
    "!hasExistingHeader('cache-control')",
    'variesOnlyByAccept',
  ].every((check) => grantChecks.includes(check))
    || !grantBranch || !ts.isIfStatement(grantBranch)
    || !findNode(grantBranch.thenStatement, (node) =>
      ts.isCallExpression(node) && node.expression.getText(dispatch) === 'response.setHeader'
      && node.arguments[0]?.getText(dispatch) === "'X-Fluo-Navigation-Prefetch'"
      && node.arguments[1]?.getText(dispatch) === "'public'")) {
    throw new Error('React navigation prefetch grant requires final HTTP identity and header eligibility.');
  }
  const backgroundRead = findNode(store, (node) =>
    ts.isMethodDeclaration(node) && node.name.getText(store) === 'approveBackground');
  const backgroundLoad = backgroundRead && findNode(backgroundRead, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'loadAndCommit');
  const backgroundInvalidation = findNode(store, (node) =>
    ts.isMethodDeclaration(node) && node.name.getText(store) === 'invalidateBackground');
  const formSubmit = findNode(form, (node) =>
    ts.isCallExpression(node) && node.expression.getText(form) === 'form.submit');
  const leaseOption = formSubmit && property(formSubmit.arguments[1], 'lease');
  const transportFetch = findNode(formTransport, (node) =>
    ts.isCallExpression(node) && node.expression.getText(formTransport) === 'fetch');
  const transportOptions = transportFetch?.arguments[1];
  const currentFormAuthority = findNode(formStore, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(formStore) === 'current');
  if (!backgroundRead || !backgroundLoad
    || backgroundLoad.arguments[1]?.getText(store) !== 'new URL(browser.currentHref())'
    || backgroundLoad.arguments[2]?.getText(store) !== "'refresh'"
    || backgroundLoad.arguments[4]?.kind !== ts.SyntaxKind.TrueKeyword
    || backgroundLoad.arguments[6]?.getText(store) !== 'revision'
    || !findNode(store, (node) => ts.isBinaryExpression(node)
      && node.getText(store) === 'expectedBackgroundRevision !== backgroundRevision')
    || !findNode(backgroundRead, (node) => ts.isBinaryExpression(node)
      && node.getText(store) === 'expectedSession !== sessionGeneration')
    || !findNode(backgroundRead, (node) => ts.isBinaryExpression(node)
      && node.getText(store) === 'pending !== null')
    || !backgroundInvalidation || findNode(backgroundInvalidation, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'router.invalidate')
    || leaseOption?.getText(form) !== 'navigation.sessionLease'
    || !currentFormAuthority || !findNode(currentFormAuthority, (node) => ts.isCallExpression(node)
      && node.expression.getText(formStore) === 'lease.current')
    || !findNode(formStore, (node) => ts.isConditionalExpression(node)
      && node.getText(formStore) === "mode === 'background' ? 'refresh' : saved.followUp")
    || !transportOptions || property(transportOptions, 'credentials')?.getText(formTransport) !== "'same-origin'"
    || property(transportOptions, 'cache')?.getText(formTransport) !== "'no-store'"
    || property(transportOptions, 'redirect')?.getText(formTransport) !== "'manual'"
    || !findNode(formTransport, (node) => ts.isConditionalExpression(node)
      && node.getText(formTransport) === "reading ? 'application/json' : MEDIA_TYPE")) {
    throw new Error('React background forms must retain session-owned JSON reads and coalesced fresh current-page approval without navigation.');
  }
}
