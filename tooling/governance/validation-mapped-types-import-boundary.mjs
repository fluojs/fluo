import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const validationRootSpecifier = '@fluojs/validation';
const validationMappedTypesSpecifier = '@fluojs/validation/mapped-types';
const mappedTypeHelpers = new Set(['IntersectionType', 'OmitType', 'PartialType', 'PickType']);

const governedPaths = [
  'packages/http/src/decorators.test.ts',
  'packages/http/src/dispatch/dispatcher.test.ts',
  'packages/openapi/src/openapi-module.test.ts',
  'packages/validation/README.md',
  'packages/validation/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  'apps/docs/content/docs/guides/validation-serialization.mdx',
  'book/beginner/ch06-validation.md',
  'book/beginner/ch06-validation.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
];

const guidanceOwners = [
  {
    sourcePath: 'packages/validation/README.md',
    preloadHeading: '## Quick Start',
    mappedHeading: '### Mapped DTO helpers',
    preloadExamples: 2,
    defaultClass: 'EmailOnlyDto',
    defaultField: 'email',
  },
  {
    sourcePath: 'packages/validation/README.ko.md',
    preloadHeading: '## 빠른 시작',
    mappedHeading: '### Mapped DTO 헬퍼',
    preloadExamples: 2,
    defaultClass: 'EmailOnlyDto',
    defaultField: 'email',
  },
  {
    sourcePath: 'docs/getting-started/migrate-from-nestjs.md',
    preloadHeading: '## Decorator metadata preload ordering',
    mappedHeading: '### Nested DTO and Mapped Type Rewrites',
    preloadExamples: 1,
    defaultClass: 'AddressOnlyDto',
    defaultField: 'address',
  },
  {
    sourcePath: 'docs/getting-started/migrate-from-nestjs.ko.md',
    preloadHeading: '## Decorator metadata 사전 로드 순서',
    mappedHeading: '### Nested DTO and Mapped Type Rewrites',
    preloadExamples: 1,
    defaultClass: 'AddressOnlyDto',
    defaultField: 'address',
  },
];

/** @param {string} relativePath */
function defaultReadText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/** @param {string} source */
function collectRootMappedTypeImports(source) {
  const imports = [];
  const pattern = new RegExp(String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]${validationRootSpecifier}['"]`, 'gu');
  let match = pattern.exec(source);

  while (match) {
    const helpers = match[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0].trim())
      .filter((entry) => mappedTypeHelpers.has(entry));

    if (helpers.length > 0) {
      imports.push(...helpers);
    }

    match = pattern.exec(source);
  }

  return imports;
}

/**
 * @param {string} source
 * @param {string} heading
 * @param {string} sourcePath
 */
function contentAfterUniqueHeading(source, heading, sourcePath) {
  const lines = source.split(/\r?\n/u);
  const matches = lines.flatMap((line, index) => line === heading ? [index] : []);
  if (matches.length !== 1) {
    throw new Error(`${sourcePath} must contain exactly one line-exact heading: ${heading}`);
  }
  const start = matches[0] + 1;
  const level = heading.split(' ')[0].length;
  const nextHeading = new RegExp(`^#{1,${level}} `, 'u');
  const end = lines.findIndex((line, index) => index >= start && nextHeading.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

/**
 * @param {string} source
 * @param {string} section
 * @param {string} contract
 * @param {string} diagnostic
 */
function contractExamples(source, section, contract, diagnostic) {
  const sentinel = `<!-- fluo-contract: validation.${contract} -->`;
  if (source.split(sentinel).length !== 2
    || section.split(/\r?\n/u).filter((line) => line === sentinel).length !== 1) {
    throw new Error(`${diagnostic} Expected exactly one ${sentinel} inside its section.`);
  }
  // Commented-out examples are not executable evidence.
  const activeSection = section.replace(/<!--[\s\S]*?-->/gu, '');
  const examples = [...activeSection.matchAll(/^```(?:ts|typescript)\r?\n([\s\S]*?)^```[ \t]*$/gmu)]
    .map((match) => {
      const result = ts.transpileModule(match[1], { reportDiagnostics: true });
      if (result.diagnostics?.some((entry) => entry.category === ts.DiagnosticCategory.Error)) {
        throw new Error(`${diagnostic} Expected parseable fenced TypeScript examples.`);
      }
      return ts.createSourceFile('example.ts', match[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    });
  if (examples.length === 0) {
    throw new Error(`${diagnostic} Expected parseable fenced TypeScript examples.`);
  }
  return examples;
}

/**
 * @param {ts.SourceFile} example
 * @param {string} specifier
 * @param {Set<string>} exportedNames
 */
function importedNames(example, specifier, exportedNames) {
  const names = new Set();
  for (const statement of example.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== specifier || statement.importClause?.isTypeOnly) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && exportedNames.has((element.propertyName ?? element.name).text)) {
          names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

/**
 * @param {ts.SourceFile} example
 * @param {string} diagnostic
 */
function enforcePreloadExample(example, diagnostic) {
  const names = importedNames(example, '@fluojs/core', new Set(['ensureMetadataSymbol']));
  const call = example.statements.find((statement) => ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && ts.isIdentifier(statement.expression.expression)
    && names.has(statement.expression.expression.text)
    && statement.expression.arguments.length === 0);
  /** @type {number[]} */
  const boundaries = [];
  let staticGraphImport = false;
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isClassDeclaration(node)
      && ((ts.getDecorators(node)?.length ?? 0) > 0
        || node.members.some((member) => ts.canHaveDecorators(member)
          && (ts.getDecorators(member)?.length ?? 0) > 0))) {
      boundaries.push(node.getStart(example));
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && !['@fluojs/core', validationRootSpecifier].includes(node.moduleSpecifier.text)
      && !node.importClause?.isTypeOnly) {
      // ESM dependencies evaluate before every body statement, regardless of position.
      staticGraphImport = true;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      boundaries.push(node.getStart(example));
    }
    ts.forEachChild(node, visit);
  }
  visit(example);
  if (!call || staticGraphImport || boundaries.length === 0
    || call.getStart(example) >= Math.min(...boundaries)) {
    throw new Error(`${diagnostic} Import and call ensureMetadataSymbol from @fluojs/core before decorated DTOs or dynamic graph imports; static graph imports are too early.`);
  }
}

/**
 * @param {ts.SourceFile[]} examples
 * @param {(typeof guidanceOwners)[number]} owner
 * @param {string} diagnostic
 */
function enforceMappedDefault(examples, owner, diagnostic) {
  const candidates = examples.flatMap((example) => {
    const helpers = importedNames(
      example,
      validationMappedTypesSpecifier,
      new Set(['PickType', 'OmitType', 'IntersectionType']),
    );
    return example.statements.filter(ts.isClassDeclaration)
      .filter((statement) => statement.name?.text === owner.defaultClass)
      .map((declaration) => ({ declaration, helpers }));
  });
  if (candidates.length !== 1) {
    throw new Error(`${diagnostic} Expected one ${owner.defaultClass} subclass example.`);
  }
  const { declaration, helpers } = candidates[0];
  const mappedBase = declaration.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
    && clause.types.some((base) => ts.isCallExpression(base.expression)
      && ts.isIdentifier(base.expression.expression)
      && helpers.has(base.expression.expression.text)));
  const defaultField = declaration.members.filter(ts.isPropertyDeclaration)
    .find((member) => ts.isIdentifier(member.name) && member.name.text === owner.defaultField);
  if (!mappedBase || !defaultField?.initializer
    || (ts.isIdentifier(defaultField.initializer) && defaultField.initializer.text === 'undefined')) {
    throw new Error(`${diagnostic} ${owner.defaultClass} must extend PickType/OmitType/IntersectionType and re-declare ${owner.defaultField} with an initializer.`);
  }
}

/**
 * Reject mapped helper imports from the validation root in TypeScript source
 * and Markdown/MDX code fences.
 *
 * @param {string} source Source text or documentation text to inspect.
 * @param {string} sourcePath Repository-relative path used in diagnostic output.
 */
export function enforceNoRootMappedTypeImports(source, sourcePath) {
  const rootMappedImports = collectRootMappedTypeImports(source);

  if (rootMappedImports.length > 0) {
    throw new Error(
      `${sourcePath} must import ${rootMappedImports.join(', ')} from ${validationMappedTypesSpecifier}, not ${validationRootSpecifier}.`,
    );
  }
}

/**
 * Enforce mapped-type imports, contract sentinels and executable example
 * structure in the EN/KO owners. Prose meaning remains a bilingual review duty.
 *
 * @param {(relativePath: string) => string} [readText] Optional source reader used to inject governance fixtures.
 */
export function enforceValidationMappedTypesImportBoundary(readText = defaultReadText) {
  for (const relativePath of governedPaths) {
    const source = readText(relativePath);
    enforceNoRootMappedTypeImports(source, relativePath);

    const owner = guidanceOwners.find((entry) => entry.sourcePath === relativePath);
    if (!owner) {
      continue;
    }
    // Resolve both headings before content checks so malformed anchors fail explicitly.
    const preload = contentAfterUniqueHeading(source, owner.preloadHeading, relativePath);
    const mapped = contentAfterUniqueHeading(source, owner.mappedHeading, relativePath);
    const preloadDiagnostic = `${relativePath} must document validation metadata preload before decorated DTO modules evaluate.`;
    const examples = contractExamples(source, preload, 'metadata-preload', preloadDiagnostic);
    if (examples.length < owner.preloadExamples) {
      throw new Error(`${preloadDiagnostic} Keep the same-module and separate-module preload examples.`);
    }
    for (const example of examples) {
      enforcePreloadExample(example, preloadDiagnostic);
    }
    const mappedDiagnostic = `${relativePath} must document validation mapped DTO constructor/default boundaries.`;
    enforceMappedDefault(contractExamples(source, mapped, 'mapped-defaults', mappedDiagnostic), owner, mappedDiagnostic);
  }
}
