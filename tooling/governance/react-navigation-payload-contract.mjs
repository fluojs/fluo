import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientPath = 'packages/react/src/client/navigation-payload.ts';
const serverPath = 'packages/react/src/page-result.ts';
const transferPath = 'packages/react/src/navigation-payload.ts';
const storePath = 'packages/react/src/client/store.ts';
const historyPath = 'packages/react/src/client/history.ts';
const providerPath = 'packages/react/src/client/provider.ts';
const dispatchPath = 'packages/http/src/dispatch/dispatch-response-policy.ts';
const mediaType = 'application/vnd.fluo.react-navigation+json;v=1';

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
  const store = ts.createSourceFile(storePath, readText(storePath), ts.ScriptTarget.Latest, true);
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
    throw new Error('React navigation HTTP and browser media types must agree on protocol version 1.');
  }

  const initialTransfer = findNode(transfer, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'createReactInitialNavigationPage');
  const initialLoad = findNode(client, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'loadReactInitialNavigationDestination');
  const serverTransfer = findNode(server, (node) =>
    ts.isCallExpression(node) && node.expression.getText(server) === 'createReactInitialNavigationPage');
  if (!initialTransfer || !initialLoad || !serverTransfer
    || !initialTransfer.getText(transfer).includes('[<>&\\u2028\\u2029]')
    || !initialTransfer.getText(transfer).includes('64 * 1024')
    || !findNode(initialLoad, (node) =>
      ts.isCallExpression(node) && node.expression.getText(client) === 'parseNavigationPayload')) {
    throw new Error('React navigation initial document transfer must retain escaping, size bounds and the shared client validator.');
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
    || historyWrites.length !== 2
    || historyWrites.some((write) => approvalGuard.end >= write.pos) || !historyRead) {
    throw new Error('React navigation must request server approval and handle rejection before history writes, including traversal.');
  }
  const refresh = findNode(store, (node) =>
    ts.isMethodDeclaration(node) && node.name.getText(store) === 'refresh');
  if (!refresh || !ts.isMethodDeclaration(refresh)
    || !findNode(refresh.body, (node) =>
      ts.isCallExpression(node) && node.expression.getText(store) === 'browser.reload')) {
    throw new Error('React navigation refresh must reload the document until soft revalidation is implemented.');
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
}
