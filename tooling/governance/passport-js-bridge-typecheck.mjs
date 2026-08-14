import ts from 'typescript';

const examplePath = '/passport-bridge/example.ts';
const virtualSources = new Map([
  ['/passport-bridge/core.d.ts', `
    export interface ModuleMetadata {
      imports?: readonly unknown[];
      providers?: readonly Provider[];
    }
    export type Provider = Function | {
      provide: symbol;
      useValue?: unknown;
      useFactory?: (...dependencies: unknown[]) => unknown;
      inject?: readonly unknown[];
    };
    export function Module(metadata: ModuleMetadata):
      (value: Function, context: ClassDecoratorContext) => void;
  `],
  ['/passport-bridge/http.d.ts', `
    export interface GuardContext {
      requestContext: {
        request: {
          method: string;
        };
      };
    }
    export interface Principal {
      subject: string;
      issuer?: string;
      audience?: string | string[];
      roles?: string[];
      scopes?: string[];
      claims: Record<string, unknown>;
    }
  `],
  ['/passport-bridge/passport.d.ts', `
    import type { GuardContext, Principal } from '@fluojs/http';
    export interface PassportJsStrategyLike {
      authenticate(request: unknown, options?: unknown): unknown;
    }
    export interface AuthStrategyRegistration {
      name: string;
      token: symbol;
    }
    export interface PassportJsStrategyBridge {
      providers: readonly import('@fluojs/core').Provider[];
      strategy: AuthStrategyRegistration;
    }
    export interface PassportJsPrincipalMapperInput {
      context: GuardContext;
      info?: unknown;
      user: unknown;
    }
    export function createPassportJsStrategyBridge(
      name: string,
      strategyToken: new (...dependencies: never[]) => PassportJsStrategyLike,
      options?: {
        mapPrincipal?: (input: PassportJsPrincipalMapperInput) => Principal;
      },
    ): PassportJsStrategyBridge;
    export const PassportModule: {
      forRoot(
        options?: { defaultStrategy?: string },
        strategies?: readonly AuthStrategyRegistration[],
      ): unknown;
    };
  `],
  ['/passport-bridge/google.strategy.d.ts', `
    export class GoogleStrategy {
      authenticate(request: unknown, options?: unknown): unknown;
    }
  `],
]);
const modulePaths = new Map([
  ['@fluojs/core', '/passport-bridge/core.d.ts'],
  ['@fluojs/http', '/passport-bridge/http.d.ts'],
  ['@fluojs/passport', '/passport-bridge/passport.d.ts'],
  ['./google.strategy.js', '/passport-bridge/google.strategy.d.ts'],
]);

function formatDiagnostics(diagnostics) {
  return diagnostics.slice(0, 8).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (!diagnostic.file || diagnostic.start === undefined) {
      return message;
    }
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${position.line + 1}:${position.character + 1} ${message}`;
  }).join('; ');
}

export function enforcePassportBridgeExampleTypes(relativePath, sourceText) {
  const sources = new Map(virtualSources);
  sources.set(examplePath, sourceText);
  const options = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options, true);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  host.fileExists = (fileName) => sources.has(fileName) || defaultFileExists(fileName);
  host.readFile = (fileName) => sources.get(fileName) ?? defaultReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sources.get(fileName);
    return source === undefined
      ? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS);
  };
  host.resolveModuleNameLiterals = (moduleLiterals) => moduleLiterals.map(({ text: moduleName }) => {
    const resolvedFileName = modulePaths.get(moduleName);
    return {
      resolvedModule: resolvedFileName === undefined
        ? undefined
        : { extension: ts.Extension.Dts, isExternalLibraryImport: true, resolvedFileName },
    };
  });

  const program = ts.createProgram([examplePath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) =>
    diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.file?.fileName === examplePath);
  if (diagnostics.length > 0) {
    throw new Error(
      `Passport.js bridge migration contract check failed: ${relativePath} example must type-check (${formatDiagnostics(diagnostics)}).`,
    );
  }
}
