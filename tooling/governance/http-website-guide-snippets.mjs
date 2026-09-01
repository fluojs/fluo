import { dirname, join, resolve } from 'node:path';
import {
  canHaveDecorators,
  createCompilerHost,
  createProgram,
  createSourceFile,
  DiagnosticCategory,
  flattenDiagnosticMessageText,
  getDecorators,
  getPreEmitDiagnostics,
  isCallExpression,
  isClassDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isPropertyDeclaration,
  isStringLiteral,
  isTypeReferenceNode,
  ModuleKind,
  ModuleResolutionKind,
  ScriptKind,
  ScriptTarget,
} from 'typescript';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const httpEntrypointPath = join(repoRoot, 'packages/http/src/index.ts');

function compilerOptions() {
  return {
    baseUrl: repoRoot,
    exactOptionalPropertyTypes: true,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.Bundler,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    paths: {
      '@fluojs/core/internal': ['packages/core/src/internal.ts'],
      '@fluojs/core/request-pipeline': ['packages/core/src/request-pipeline.ts'],
      '@fluojs/*': ['packages/*/src/index.ts'],
    },
    skipLibCheck: true,
    strict: true,
    target: ScriptTarget.ES2022,
    types: ['node'],
  };
}

function virtualSnippetPath(relativePath) {
  return join(repoRoot, '.virtual-http-docs', relativePath.replace(/\.(?:md|mdx)$/u, '.ts'));
}

export function intendedHttpSnippets(markdown) {
  return [...markdown.matchAll(/```ts\n([\s\S]*?)```/gu)]
    .map((match) => match[1])
    .filter((source) => source !== undefined)
    .filter((source) => /\b(?:Controller|FromBody|FromPath|Get|Post|RequestDto)\b/u.test(source));
}

function virtualFixtures(relativePath) {
  if (!relativePath.includes('first-feature')) {
    return new Map();
  }

  return new Map([
    [
      join(dirname(virtualSnippetPath(relativePath)), 'users.service.ts'),
      `export class UsersService {
  create(name: string): { readonly id: string; readonly name: string } {
    return { id: '1', name };
  }

  findById(id: string): { readonly id: string; readonly name: string } | undefined {
    return { id, name: 'Ada' };
  }
}
`,
    ],
  ]);
}

export function semanticDiagnostics(relativePath, sourceText) {
  const sourcePath = virtualSnippetPath(relativePath);
  const sourceFiles = new Map([[sourcePath, sourceText], ...virtualFixtures(relativePath)]);
  const options = compilerOptions();
  const host = createCompilerHost(options, true);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultDirectoryExists = host.directoryExists?.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const virtualDirectories = new Set([...sourceFiles.keys()].map((fileName) => dirname(fileName)));

  host.directoryExists = (directoryName) => virtualDirectories.has(directoryName) || defaultDirectoryExists?.(directoryName) === true;
  host.fileExists = (fileName) => sourceFiles.has(fileName) || defaultFileExists(fileName);
  host.readFile = (fileName) => sourceFiles.get(fileName) ?? defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sourceFiles.get(fileName);

    return source === undefined
      ? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : createSourceFile(fileName, source, languageVersion, true, ScriptKind.TS);
  };

  const program = createProgram([sourcePath], options, host);

  return getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error && diagnostic.file?.fileName === sourcePath)
    .map((diagnostic) => {
      const message = flattenDiagnosticMessageText(diagnostic.messageText, '\n');

      if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return message;
      }

      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${position.line + 1}:${position.character + 1} ${message}`;
    });
}

export function exportedHttpNames() {
  const options = compilerOptions();
  const program = createProgram([httpEntrypointPath], options);
  const entrypoint = program.getSourceFile(httpEntrypointPath);

  if (entrypoint === undefined) {
    throw new TypeError('Missing HTTP public entry point.');
  }

  const symbol = program.getTypeChecker().getSymbolAtLocation(entrypoint);

  if (symbol === undefined) {
    throw new TypeError('Could not resolve HTTP public entry point exports.');
  }

  return new Set(program.getTypeChecker().getExportsOfModule(symbol).map((exported) => exported.getName()));
}

function decoratorCall(node, name) {
  if (!isCallExpression(node.expression) || !isIdentifier(node.expression.expression)) {
    return undefined;
  }

  return node.expression.expression.text === name ? node.expression : undefined;
}

function decorators(node) {
  return canHaveDecorators(node) ? getDecorators(node) ?? [] : [];
}

function decorator(node, name) {
  return decorators(node)
    .map((candidate) => decoratorCall(candidate, name))
    .find((candidate) => candidate !== undefined);
}

function identifierArgument(call) {
  const [argument] = call?.arguments ?? [];
  return argument && isIdentifier(argument) ? argument.text : undefined;
}

function stringArgument(call) {
  const [argument] = call?.arguments ?? [];
  return argument && isStringLiteral(argument) ? argument.text : undefined;
}

function classDeclarations(sourceFile) {
  return new Map(
    sourceFile.statements
      .filter(isClassDeclaration)
      .flatMap((declaration) => declaration.name ? [[declaration.name.text, declaration]] : []),
  );
}

/**
 * @typedef {{
 *   readonly key: string | undefined;
 *   readonly member: string;
 *   readonly source: 'FromBody' | 'FromPath';
 * }} DtoBinding
 */

/**
 * @typedef {{
 *   readonly bindings: readonly DtoBinding[];
 *   readonly method: 'Get' | 'Post';
 *   readonly name: string;
 *   readonly parameterDto: string | undefined;
 *   readonly pathPlaceholders: readonly string[];
 *   readonly requestDto: string | undefined;
 *   readonly routePath: string;
 * }} GuideRouteBinding
 */

/** @returns {DtoBinding[]} */
function dtoBindings(declaration) {
  return declaration.members
    .filter(isPropertyDeclaration)
    .flatMap((member) => {
      const fromBody = decorator(member, 'FromBody');
      const fromPath = decorator(member, 'FromPath');
      const source = fromBody ? 'FromBody' : fromPath ? 'FromPath' : undefined;

      return member.name && isIdentifier(member.name) && source
        ? [{
          key: source === 'FromPath' ? stringArgument(fromPath) ?? member.name.text : undefined,
          member: member.name.text,
          source,
        }]
        : [];
    });
}

/** @returns {GuideRouteBinding[]} */
export function routeBindings(sourceText) {
  const sourceFile = createSourceFile('snippet.ts', sourceText, ScriptTarget.ES2022, true, ScriptKind.TS);
  const classes = classDeclarations(sourceFile);
  /** @type {GuideRouteBinding[]} */
  const routes = [];

  for (const declaration of classes.values()) {
    if (decorator(declaration, 'Controller') === undefined) {
      continue;
    }

    for (const member of declaration.members.filter(isMethodDeclaration)) {
      const method = ['Get', 'Post']
        .find((candidate) => decorator(member, candidate) !== undefined);

      if (method === undefined || member.name === undefined || !isIdentifier(member.name)) {
        continue;
      }

      const requestDto = identifierArgument(decorator(member, 'RequestDto'));
      const parameterType = member.parameters[0]?.type;
      const parameterDto = parameterType && isTypeReferenceNode(parameterType) && isIdentifier(parameterType.typeName)
        ? parameterType.typeName.text
        : undefined;
      const dto = requestDto ? classes.get(requestDto) : undefined;
      const routePath = stringArgument(decorator(member, method)) ?? '';
      const pathPlaceholders = routePath.split('/')
        .flatMap((segment) => segment.startsWith(':') ? [segment.slice(1)] : []);

      routes.push({
        bindings: dto ? dtoBindings(dto) : [],
        method,
        name: member.name.text,
        parameterDto,
        pathPlaceholders,
        requestDto,
        routePath,
      });
    }
  }

  return routes;
}

export function classDecoratorArguments(sourceText, className, decoratorName) {
  const sourceFile = createSourceFile('snippet.ts', sourceText, ScriptTarget.ES2022, true, ScriptKind.TS);
  const declaration = classDeclarations(sourceFile).get(className);
  const call = declaration ? decorator(declaration, decoratorName) : undefined;

  return call?.arguments.map((argument) => argument.getText(sourceFile)) ?? [];
}
