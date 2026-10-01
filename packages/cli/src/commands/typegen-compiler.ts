import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';

import { TypegenCommandError } from './typegen-options.js';

/** One frozen lexical declaration identity, independent of runtime route registration. */
export type TypegenDeclaration = {
  readonly id: string;
  readonly node: ts.ClassLikeDeclaration;
  readonly source: ts.SourceFile;
};

/** Frozen compiler input and actual evaluated object associations for one generation. */
export class TypegenCompiler {
  readonly checker: ts.TypeChecker;
  readonly fingerprint: string;
  readonly options: ts.CompilerOptions;
  readonly sources: ReadonlyMap<string, ts.SourceFile>;
  readonly configurationFiles: ReadonlyMap<string, string>;
  private readonly declarations = new Map<string, TypegenDeclaration>();
  private readonly objects = new WeakMap<object, TypegenDeclaration>();
  private readonly calls = new Map<string, ts.CallExpression>();
  private readonly instantiated = new WeakMap<object, ts.Type>();

  private constructor(readonly cwd: string, private readonly program: ts.Program, configurationFiles: ReadonlyMap<string, string>, artifactPath?: string) {
    this.checker = program.getTypeChecker();
    this.options = program.getCompilerOptions();
    this.configurationFiles = configurationFiles;
    this.sources = new Map(program.getSourceFiles().map((source) => [resolve(source.fileName), source]));
    const sourceKey = (path: string): string => {
      const normalized = path.replaceAll('\\', '/');
      const dependency = normalized.lastIndexOf('/node_modules/');
      return dependency < 0
        ? relative(cwd, path).replaceAll('\\', '/')
        : normalized.slice(dependency + 1);
    };
    const hash = createHash('sha256').update(ts.version).update('\0').update(JSON.stringify(
      this.options,
      (_key, value: unknown) => typeof value === 'string' && isAbsolute(value) ? sourceKey(value) : value,
    ));
    for (const [path, text] of [...configurationFiles].sort(([left], [right]) => sourceKey(left) < sourceKey(right) ? -1 : sourceKey(left) > sourceKey(right) ? 1 : 0)) {
      hash.update(sourceKey(path)).update('\0').update(text).update('\0');
    }
    for (const [path, source] of [...this.sources].sort(([left], [right]) => sourceKey(left) < sourceKey(right) ? -1 : sourceKey(left) > sourceKey(right) ? 1 : 0)) {
      if (path !== artifactPath) hash.update(sourceKey(path)).update('\0').update(source.text).update('\0');
      let ordinal = 0;
      let callOrdinal = 0;
      const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
          const id = `${relative(cwd, path).replaceAll('\\', '/')}:${ts.SyntaxKind[node.kind]}:${ordinal++}`;
          this.declarations.set(id, Object.freeze({ id, node, source }));
        }
        if (ts.isCallExpression(node)) {
          const id = `${relative(cwd, path).replaceAll('\\', '/')}:CallExpression:${callOrdinal++}`;
          this.calls.set(id, node);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    this.fingerprint = hash.digest('hex');
  }

  /**
   * Freeze the actual application compiler graph, including type-only dependencies.
   *
   * @param options Application root, module path and actual compiler configuration.
   * @returns A generation-owned compiler snapshot.
   */
  static create(options: { readonly cwd: string; readonly modulePath: string; readonly tsconfigPath: string; readonly artifactPath?: string }): TypegenCompiler {
    const configurationFiles = new Map<string, string>();
    const readConfiguration = (path: string): string | undefined => {
      const text = ts.sys.readFile(path);
      if (text !== undefined) configurationFiles.set(resolve(path), text);
      return text;
    };
    const config = ts.readConfigFile(options.tsconfigPath, readConfiguration);
    if (config.error !== undefined) {
      throw new TypegenCommandError(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, { ...ts.sys, readFile: readConfiguration }, resolve(options.tsconfigPath, '..'));
    if (parsed.errors.length !== 0) {
      throw new TypegenCommandError(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: () => options.cwd,
        getNewLine: () => '\n',
      }));
    }
    const program = ts.createProgram({
      options: parsed.options,
      rootNames: [...new Set([...parsed.fileNames, resolve(options.cwd, options.modulePath)])],
    });
    return new TypegenCompiler(options.cwd, program, configurationFiles, options.artifactPath);
  }

  /**
   * Bind a final evaluated constructor to its instrumented frozen declaration.
   *
   * @param id Lexical source identity embedded by this snapshot's transformer.
   * @param value Actual post-decoration constructor, not a name or registration index.
   */
  associate(id: string, value: object): void {
    const declaration = this.declarations.get(id);
    if (declaration === undefined || this.objects.has(value)) {
      throw new TypegenCommandError(`Ambiguous compiler association at ${id}. Restart typegen with the current source.`);
    }
    this.objects.set(value, declaration);
  }

  /**
   * Resolve an actual descriptor constructor to its compiler declaration.
   *
   * @param value Compiled controller or request DTO constructor.
   * @returns Its unique source declaration.
   */
  declaration(value: object): TypegenDeclaration {
    const declaration = this.objects.get(value);
    if (declaration === undefined) {
      throw new TypegenCommandError('Unavailable source association for compiled HTTP constructor. Include its source in the application tsconfig.');
    }
    return declaration;
  }

  /**
   * Record an evaluated source expression while preserving its original value.
   *
   * @param id Frozen class or factory-call source identity.
   * @param value Actual evaluated value from that expression.
   * @returns The unchanged application value.
   */
  record(id: string, value: unknown): unknown {
    if (this.declarations.has(id)) {
      if (typeof value !== 'function') throw new TypegenCommandError(`${id}: class evaluation did not return a constructor.`);
      this.associate(id, value);
      return value;
    }
    const call = this.calls.get(id);
    if (call === undefined) throw new TypegenCommandError(`${id}: unknown frozen factory call.`);
    const bind = (actual: unknown, type: ts.Type): void => {
      if (typeof actual === 'function' && type.getConstructSignatures().length > 0 && this.objects.has(actual)) {
        const instance = type.getConstructSignatures()[0]?.getReturnType();
        const declaration = this.objects.get(actual);
        if (declaration !== undefined && instance?.getSymbol()?.declarations?.includes(declaration.node) === true) {
          const previous = this.instantiated.get(actual)?.getConstructSignatures()[0]?.getReturnType();
          if (previous !== undefined && (!this.checker.isTypeAssignableTo(previous, instance)
            || !this.checker.isTypeAssignableTo(instance, previous))) {
            throw new TypegenCommandError(`${id}: the same actual constructor has incompatible generic factory instantiations.`);
          }
          this.instantiated.set(actual, type);
        }
      } else if (typeof actual === 'object' && actual !== null) {
        for (const property of this.checker.getPropertiesOfType(type)) {
          const data = Object.getOwnPropertyDescriptor(actual, property.getName());
          if (data === undefined || !('value' in data)) continue;
          const memberType = this.checker.getTypeOfSymbolAtLocation(property, call);
          if (memberType.getConstructSignatures().length > 0) bind(data.value, memberType);
        }
      }
    };
    bind(value, this.checker.getTypeAtLocation(call));
    return value;
  }

  /**
   * Resolve the instance type of the exact evaluated constructor, including factory instantiation.
   *
   * @param value An instrumented controller or DTO constructor.
   * @returns Its actual compiler instance type.
   */
  instanceType(value: object): ts.Type {
    const contextual = this.instantiated.get(value)?.getConstructSignatures()[0]?.getReturnType();
    const direct = this.checker.getTypeAtLocation(this.declaration(value).node);
    return contextual ?? direct.getConstructSignatures()[0]?.getReturnType() ?? direct;
  }

  /**
   * Resolve a public module export through the actual application's compiler graph.
   *
   * @param moduleId Authored public module specifier.
   * @param name Exported semantic symbol name.
   * @param node Source location that owns module resolution.
   * @returns The canonical symbol, with re-export aliases resolved.
   */
  exportSymbol(moduleId: string, name: string, node: ts.Node): ts.Symbol | undefined {
    const path = ts.resolveModuleName(moduleId, node.getSourceFile().fileName, this.options, ts.sys).resolvedModule?.resolvedFileName;
    const source = path === undefined ? undefined : this.program.getSourceFile(path);
    const namespace = source === undefined ? undefined : this.checker.getSymbolAtLocation(source);
    const symbol = namespace === undefined ? undefined : this.checker.getExportsOfModule(namespace).find((member) => member.getName() === name);
    return symbol === undefined ? undefined : (symbol.flags & ts.SymbolFlags.Alias) ? this.checker.getAliasedSymbol(symbol) : symbol;
  }

  /**
   * Emit one frozen module with tooling-only class association instrumentation.
   *
   * @param path Absolute module path from the frozen graph.
   * @param recorder Generation-owned global key recording final object identities.
   * @returns JavaScript evaluated only by the tooling loader.
   */
  emit(path: string, recorder: string): string {
    const source = this.sources.get(resolve(path));
    if (source === undefined || source.isDeclarationFile) {
      throw new TypegenCommandError(`${relative(this.cwd, path)}: source is unavailable in the frozen compiler graph.`);
    }
    const identities = [...this.declarations.values()].filter((entry) => entry.source === source);
    const callIdentities = new Map([...this.calls].filter(([, call]) => call.getSourceFile() === source)
      .map(([id, call]) => [call.pos, id]));
    let ordinal = 0;
    const recordExpression = ts.factory.createElementAccessExpression(
      ts.factory.createIdentifier('globalThis'), ts.factory.createStringLiteral(recorder),
    );
    return ts.transpileModule(source.text, {
      compilerOptions: { ...this.options, declaration: false, emitDeclarationOnly: false, module: ts.ModuleKind.ESNext },
      fileName: path,
      transformers: {
        before: [(context) => {
          const visit: ts.Visitor = (node) => {
            if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
              const identity = identities[ordinal++];
              if (identity === undefined) throw new TypegenCommandError(`${path}: frozen declaration mismatch.`);
              const decorator = ts.factory.createDecorator(ts.factory.createCallExpression(
                recordExpression, undefined, [ts.factory.createStringLiteral(identity.id)],
              ));
              const modifiers = [decorator, ...ts.visitNodes(node.modifiers, visit, ts.isModifierLike) ?? []];
              const members = ts.visitNodes(node.members, visit, ts.isClassElement);
              if (ts.isClassDeclaration(node)) {
                return ts.factory.updateClassDeclaration(node, modifiers, node.name, node.typeParameters, node.heritageClauses, members);
              }
              return ts.factory.updateClassExpression(node, modifiers, node.name, node.typeParameters, node.heritageClauses, members);
            }
            if (ts.isCallExpression(node) && node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
              const id = callIdentities.get(node.pos);
              if (id === undefined) throw new TypegenCommandError(`${path}: frozen call mismatch.`);
              return ts.factory.createCallExpression(
                ts.factory.createCallExpression(recordExpression, undefined, [ts.factory.createStringLiteral(id)]),
                undefined, [ts.visitEachChild(node, visit, context)],
              );
            }
            return ts.visitEachChild(node, visit, context);
          };
          return (file) => ts.visitNode(file, visit, ts.isSourceFile) ?? file;
        }],
      },
    }).outputText;
  }
}
