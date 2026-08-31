import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
const workspacePublicTypes = join(repoRoot, 'packages', '*', 'dist', 'index.d.ts');

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

function collectDiagnostics(files) {
  const compilerOptions = {
    exactOptionalPropertyTypes: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    paths: {
      '@fluojs/*': [workspacePublicTypes],
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

    return sourceText === undefined
      ? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS);
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
export function enforceJwtLearningPathModuleWiring(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const relativePath of chapterPaths) {
    const diagnostics = collectDiagnostics(extractLearningFiles(relativePath, readText(relativePath)));

    if (diagnostics.length > 0) {
      fail(
        relativePath,
        `must typecheck as the complete virtual JWT learning path:\n${diagnostics.join('\n')}`,
      );
    }
  }
}
