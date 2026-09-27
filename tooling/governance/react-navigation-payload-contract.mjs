import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const clientPath = 'packages/react/src/client/navigation-payload.ts';
const serverPath = 'packages/react/src/page-result.ts';
const storePath = 'packages/react/src/client/store.ts';
const historyPath = 'packages/react/src/client/history.ts';
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

export function enforceReactNavigationPayloadContract(
  readText = (path) => readFileSync(resolve(repoRoot, path), 'utf8'),
) {
  const client = ts.createSourceFile(clientPath, readText(clientPath), ts.ScriptTarget.Latest, true);
  const server = ts.createSourceFile(serverPath, readText(serverPath), ts.ScriptTarget.Latest, true);
  const store = ts.createSourceFile(storePath, readText(storePath), ts.ScriptTarget.Latest, true);
  const history = ts.createSourceFile(historyPath, readText(historyPath), ts.ScriptTarget.Latest, true);
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

  const fetchCall = findNode(client, (node) =>
    ts.isCallExpression(node) && node.expression.getText(client) === 'fetch');
  const options = fetchCall && ts.isCallExpression(fetchCall) ? fetchCall.arguments[1] : undefined;
  const headers = options && ts.isObjectLiteralExpression(options) ? property(options, 'headers') : undefined;
  const accept = headers && ts.isObjectLiteralExpression(headers) ? property(headers, 'Accept') : undefined;
  if (!options || !ts.isObjectLiteralExpression(options)
    || !accept || !ts.isIdentifier(accept) || accept.text !== 'MEDIA_TYPE'
    || !['cache:no-store', 'credentials:same-origin', 'redirect:manual'].every((pair) => {
      const [name, expected] = pair.split(':');
      const value = property(options, name);
      return value && ts.isStringLiteral(value) && value.text === expected;
    })) {
    throw new Error('React navigation must request the explicit media type with same-origin credentials, no cache, and manual redirects.');
  }

  const approvalGuard = findNode(store, (node) =>
    ts.isIfStatement(node) && node.expression.getText(store) === '!result.ok');
  const request = findNode(store, (node) =>
    ts.isCallExpression(node) && node.expression.getText(store) === 'load'
    && node.arguments[0]?.getText(store) === 'destination.href'
    && node.arguments[1]?.getText(store) === 'controller.signal');
  const historyWrite = findNode(store, (node) =>
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
    || !request || !historyWrite || approvalGuard.end >= historyWrite.pos || !historyRead) {
    throw new Error('React navigation must request server approval and handle rejection before history writes, including traversal.');
  }
}
