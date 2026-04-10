import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const packageSourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}.`);
  }

  return result;
}

function changedFilesFromGit() {
  const preferredBase = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  const mergeBaseResult = run('git', ['merge-base', 'HEAD', preferredBase], { allowFailure: true });
  const changedFiles = new Set();

  function addDiffFiles(args) {
    const diffResult = run('git', args, { allowFailure: true });
    if (diffResult.status !== 0) {
      return;
    }

    for (const line of diffResult.stdout.split('\n')) {
      const path = line.trim();
      if (path.length > 0) {
        changedFiles.add(path);
      }
    }
  }

  if (mergeBaseResult.status === 0 && mergeBaseResult.stdout.trim().length > 0) {
    const mergeBase = mergeBaseResult.stdout.trim();
    addDiffFiles(['diff', '--name-only', `${mergeBase}...HEAD`]);
  }

  if (changedFiles.size === 0) {
    addDiffFiles(['diff', '--name-only', 'HEAD~1...HEAD']);
  }

  addDiffFiles(['diff', '--name-only']);
  addDiffFiles(['diff', '--name-only', '--cached']);

  return [...changedFiles].sort((left, right) => left.localeCompare(right));
}

function preferredBaseRefFromGit() {
  const preferredBase = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  const mergeBaseResult = run('git', ['merge-base', 'HEAD', preferredBase], { allowFailure: true });

  if (mergeBaseResult.status === 0 && mergeBaseResult.stdout.trim().length > 0) {
    return mergeBaseResult.stdout.trim();
  }

  const headParentResult = run('git', ['rev-parse', 'HEAD~1'], { allowFailure: true });
  if (headParentResult.status === 0 && headParentResult.stdout.trim().length > 0) {
    return headParentResult.stdout.trim();
  }

  return null;
}

function readAtGitRef(gitRef, relativePath) {
  if (!gitRef) {
    return null;
  }

  const result = run('git', ['show', `${gitRef}:${relativePath}`], { allowFailure: true });
  if (result.status !== 0) {
    return null;
  }

  return result.stdout;
}

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Public export TSDoc check failed: ${message}`);
  }
}

export function isGovernedPublicExportSourcePath(relativePath) {
  if (!relativePath.startsWith('packages/')) {
    return false;
  }

  if (!relativePath.includes('/src/')) {
    return false;
  }

  if (relativePath.endsWith('.d.ts')) {
    return false;
  }

  if (/\.(test|spec)\.[^.]+$/.test(relativePath)) {
    return false;
  }

  return packageSourceExtensions.has(extname(relativePath));
}

function hasExportModifier(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getNodeJSDoc(node) {
  return Array.isArray(node.jsDoc) ? node.jsDoc : [];
}

function getJSDocSummary(node) {
  const docs = getNodeJSDoc(node);
  const latestDoc = docs.at(-1);
  if (!latestDoc) {
    return '';
  }

  const { comment } = latestDoc;
  if (typeof comment === 'string') {
    return comment.trim();
  }

  if (Array.isArray(comment)) {
    return comment
      .map((part) => ('text' in part ? String(part.text) : ''))
      .join('')
      .trim();
  }

  return '';
}

function getLineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function getNodeName(node) {
  if ('name' in node && node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  return 'default export';
}

function getDeclarationKind(node) {
  if (ts.isFunctionDeclaration(node)) {
    return 'function';
  }

  if (ts.isClassDeclaration(node)) {
    return 'class';
  }

  if (ts.isInterfaceDeclaration(node)) {
    return 'interface';
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return 'type';
  }

  if (ts.isEnumDeclaration(node)) {
    return 'enum';
  }

  if (ts.isVariableDeclaration(node)) {
    return 'const';
  }

  return 'export';
}

function getParameterNames(node) {
  if (!('parameters' in node) || !Array.isArray(node.parameters)) {
    return [];
  }

  return node.parameters
    .filter((parameter) => ts.isIdentifier(parameter.name))
    .map((parameter) => parameter.name.text);
}

function requiresReturnsTag(node) {
  if (!('type' in node) || !node.type) {
    return false;
  }

  const typeText = node.type.getText().replace(/\s+/g, '');
  return typeText !== 'void' && typeText !== 'never';
}

function getCallableExportNode(node) {
  if (ts.isFunctionDeclaration(node)) {
    return node;
  }

  if (!ts.isVariableDeclaration(node)) {
    return null;
  }

  const initializer = node.initializer;
  if (!initializer) {
    return null;
  }

  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return initializer;
  }

  return null;
}

function collectDeclarationViolations(sourceFile, node, jsDocNode = node) {
  const missing = [];
  const summary = getJSDocSummary(jsDocNode);
  const tags = ts.getJSDocTags(jsDocNode);
  const callableNode = getCallableExportNode(node);

  if (summary.length === 0) {
    missing.push('summary');
  }

  if (callableNode) {
    const paramTags = new Set(
      tags
        .filter((tag) => tag.tagName.text === 'param' && 'name' in tag && tag.name && ts.isIdentifier(tag.name))
        .map((tag) => tag.name.text),
    );

    for (const parameterName of getParameterNames(callableNode)) {
      if (!paramTags.has(parameterName)) {
        missing.push(`@param ${parameterName}`);
      }
    }

    if (
      requiresReturnsTag(callableNode) &&
      !tags.some((tag) => tag.tagName.text === 'returns' || tag.tagName.text === 'return')
    ) {
      missing.push('@returns');
    }
  }

  if (missing.length === 0) {
    return null;
  }

  return {
    kind: getDeclarationKind(node),
    line: getLineNumber(sourceFile, jsDocNode),
    name: getNodeName(node),
    path: sourceFile.fileName,
    reason: missing.join(', '),
  };
}

function collectExportedDeclarations(sourceFile) {
  const declarations = [];

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        declarations.push({ declaration, jsDocNode: statement });
      }
      continue;
    }

    if (!hasExportModifier(statement)) {
      continue;
    }

    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      declarations.push({ declaration: statement, jsDocNode: statement });
    }
  }

  return declarations;
}

function serializeExportedDeclarations(source) {
  const sourceFile = ts.createSourceFile('export-signature.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printer = ts.createPrinter({ removeComments: true });

  return collectExportedDeclarations(sourceFile).map(({ declaration }) => ({
    declarationText: printer.printNode(ts.EmitHint.Unspecified, declaration, sourceFile).replace(/\s+/g, ' ').trim(),
    kind: getDeclarationKind(declaration),
    name: getNodeName(declaration),
  }));
}

function hasChangedPublicExportDeclarations(_relativePath, currentSource, previousSource) {
  if (previousSource === null) {
    return true;
  }

  const currentDeclarations = serializeExportedDeclarations(currentSource);
  const previousDeclarations = serializeExportedDeclarations(previousSource);

  return JSON.stringify(currentDeclarations) !== JSON.stringify(previousDeclarations);
}

function diffShowsChangedPublicExportDeclaration(diffText) {
  return diffText
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
    .some((line) => /^[-+]\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var|\{)/.test(line));
}

function fileHasChangedPublicExportDeclarationFromGit(relativePath, gitRef = preferredBaseRefFromGit()) {
  if (!gitRef) {
    return true;
  }

  const diffResult = run('git', ['diff', '--no-color', '-U0', gitRef, '--', relativePath], { allowFailure: true });
  if (diffResult.status !== 0) {
    return true;
  }

  return diffShowsChangedPublicExportDeclaration(diffResult.stdout);
}

export function changedPublicExportSourcePathsFromGit(
  relativePaths = changedFilesFromGit().filter((path) => isGovernedPublicExportSourcePath(path)),
  readSource = read,
  gitRef = preferredBaseRefFromGit(),
  readSourceAtRef = readAtGitRef,
  hasChangedDeclaration = fileHasChangedPublicExportDeclarationFromGit,
) {
  return relativePaths.filter((relativePath) => {
    if (!hasChangedDeclaration(relativePath, gitRef)) {
      return false;
    }

    const currentSource = readSource(relativePath);
    const previousSource = readSourceAtRef(gitRef, relativePath);
    return hasChangedPublicExportDeclarations(relativePath, currentSource, previousSource);
  });
}

function scriptKindForPath(relativePath) {
  const extension = extname(relativePath);

  switch (extension) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.ts':
    case '.mts':
    case '.cts':
      return ts.ScriptKind.TS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

export function collectPublicExportTSDocViolations(relativePaths, readSource = read) {
  const violations = [];

  for (const relativePath of relativePaths) {
    if (!isGovernedPublicExportSourcePath(relativePath)) {
      continue;
    }

    const source = readSource(relativePath);
    const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, scriptKindForPath(relativePath));

    for (const { declaration, jsDocNode } of collectExportedDeclarations(sourceFile)) {
      const violation = collectDeclarationViolations(sourceFile, declaration, jsDocNode);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  return violations;
}

export function enforcePublicExportTSDocBaseline(
  relativePaths = changedPublicExportSourcePathsFromGit(),
  readSource = read,
) {
  const violations = collectPublicExportTSDocViolations(relativePaths, readSource);

  assert(
    violations.length === 0,
    [
      'changed public exports must include a TSDoc summary and matching @param/@returns tags when applicable.',
      'Use docs/operations/public-export-tsdoc-baseline.md for the authoring checklist and golden examples.',
      ...violations.map(
        (violation) => `${violation.path}:${violation.line} ${violation.kind} ${violation.name} is missing ${violation.reason}`,
      ),
    ].join('\n'),
  );
}

export function main() {
  enforcePublicExportTSDocBaseline();
  console.log('Public export TSDoc checks passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
