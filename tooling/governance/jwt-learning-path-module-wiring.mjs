import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { probeJwtLearningPathRuntimeGraph } from './jwt-learning-path-module-runtime-probe.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const chapterPaths = ['book/beginner/ch14-jwt.md', 'book/beginner/ch14-jwt.ko.md'];
const learningFilePaths = [
  'src/auth/auth.persistence.ts',
  'src/auth/auth.service.ts',
  'src/auth/auth.controller.ts',
  'src/auth/auth.module.ts',
];
const learningFileHeader = /^\/\/ (src\/auth\/auth\.(?:persistence|service|controller|module)\.ts)\n/u;
const virtualRoot = join(repoRoot, '.virtual-jwt-learning-path');
const workspacePublicSources = join(repoRoot, 'packages', '*', 'src', 'index.ts');
const workspaceSourceFileCache = new Map();

function fail(relativePath, message) {
  throw new Error(
    `JWT learning-path module wiring check failed: ${relativePath} ${message}.`,
  );
}

function extractLearningFiles(relativePath, markdown) {
  const files = new Map();

  for (const match of markdown.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/gu)) {
    const source = match[1] ?? '';
    const header = learningFileHeader.exec(source);

    if (header?.[1] !== undefined) {
      files.set(header[1], source.slice(header[0].length));
    }
  }

  for (const learningFilePath of learningFilePaths) {
    if (!files.has(learningFilePath)) {
      fail(relativePath, `must include a \`// ${learningFilePath}\` TypeScript code block`);
    }
  }

  return files;
}

function normalizeSource(sourceText) {
  return sourceText.replace(/\s+/gu, ' ').trim();
}

function enforceExplicitModuleWiring(relativePath, files) {
  const persistenceSource = files.get('src/auth/auth.persistence.ts');
  const serviceSource = files.get('src/auth/auth.service.ts');
  const moduleSource = files.get('src/auth/auth.module.ts');

  if (
    persistenceSource === undefined
    || serviceSource === undefined
    || moduleSource === undefined
  ) {
    fail(relativePath, 'must include every JWT learning-path source block before checking DI wiring');
  }

  const injectionMetadata = [
    [persistenceSource, '@Inject(REFRESH_TOKEN_REPOSITORY)', 'DatabaseRefreshTokenStore'],
    [persistenceSource, '@Inject(CREDENTIALS_REPOSITORY)', 'DatabaseCredentialsVerifier'],
    [serviceSource, '@Inject(CREDENTIALS_VERIFIER, JwtService, RefreshTokenService)', 'AuthService'],
  ];

  for (const [sourceText, metadata, className] of injectionMetadata) {
    if (!sourceText.includes(metadata)) {
      fail(relativePath, `${className} must declare explicit ${metadata} constructor metadata`);
    }
  }

  if (/\bproviders:\s*\[\s*(?:DatabaseRefreshTokenStore|DatabaseCredentialsVerifier)\s*,/u.test(moduleSource)) {
    fail(relativePath, 'must not register a persistence adapter as a bare class provider');
  }

  const normalizedModuleSource = normalizeSource(moduleSource);
  const explicitProviders = [
    '{ provide: REFRESH_TOKEN_STORE, useClass: DatabaseRefreshTokenStore, inject: [REFRESH_TOKEN_REPOSITORY], }',
    '{ provide: CREDENTIALS_VERIFIER, useClass: DatabaseCredentialsVerifier, inject: [CREDENTIALS_REPOSITORY], }',
  ];

  for (const provider of explicitProviders) {
    if (!normalizedModuleSource.includes(provider)) {
      fail(relativePath, `must bind persistence adapters through explicit provider metadata: ${provider}`);
    }
  }
}

function collectDiagnostics(files) {
  const compilerOptions = {
    baseUrl: repoRoot,
    exactOptionalPropertyTypes: true,
    ignoreDeprecations: '6.0',
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    paths: {
      '@fluojs/*': [workspacePublicSources],
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: ['node'],
  };
  const virtualFiles = new Map(
    [...files].map(([filePath, sourceText]) => [join(virtualRoot, filePath), sourceText]),
  );
  const virtualDirectories = new Set(
    [...virtualFiles.keys()].flatMap((fileName) => [
      dirname(fileName),
      dirname(dirname(fileName)),
      dirname(dirname(dirname(fileName))),
    ]),
  );
  const host = ts.createCompilerHost(compilerOptions, true);
  const defaultDirectoryExists = host.directoryExists.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const isVirtualFile = (fileName) => virtualFiles.has(resolve(fileName));

  host.directoryExists = (directoryName) =>
    virtualDirectories.has(resolve(directoryName)) || defaultDirectoryExists(directoryName);
  host.fileExists = (fileName) => isVirtualFile(fileName) || defaultFileExists(fileName);
  host.readFile = (fileName) => virtualFiles.get(resolve(fileName)) ?? defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const sourceText = virtualFiles.get(resolve(fileName));

    if (sourceText !== undefined) {
      return ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS);
    }

    const cacheKey = `${resolve(fileName)}:${String(languageVersion)}`;
    const cachedSourceFile = workspaceSourceFileCache.get(cacheKey);

    if (cachedSourceFile !== undefined && !shouldCreateNewSourceFile) {
      return ts.createSourceFile(
        fileName,
        cachedSourceFile.text,
        languageVersion,
        true,
        cachedSourceFile.scriptKind,
      );
    }

    const sourceFile = defaultGetSourceFile(
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    );

    if (sourceFile !== undefined) {
      workspaceSourceFileCache.set(cacheKey, ts.createSourceFile(
        fileName,
        sourceFile.text,
        languageVersion,
        true,
        sourceFile.scriptKind,
      ));
    }

    return sourceFile;
  };

  const program = ts.createProgram([...virtualFiles.keys()], compilerOptions, host);

  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .filter((diagnostic) => diagnostic.file === undefined || isVirtualFile(diagnostic.file.fileName))
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

      if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return message;
      }

      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName.replace(`${virtualRoot}/`, '')}:${position.line + 1}:${position.character + 1} ${message}`;
    });
}

/**
 * Typechecks the complete Chapter 14 JWT learning path as virtual source files
 * against the workspace's public package declarations.
 */
export async function enforceJwtLearningPathModuleWiring(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const relativePath of chapterPaths) {
    const files = extractLearningFiles(relativePath, readText(relativePath));
    enforceExplicitModuleWiring(relativePath, files);
    const diagnostics = collectDiagnostics(files);

    if (diagnostics.length > 0) {
      fail(
        relativePath,
        `must typecheck as the complete virtual JWT learning path:\n${diagnostics.join('\n')}`,
      );
    }

    await probeJwtLearningPathRuntimeGraph(relativePath, files);
  }
}
