import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import mongoose from 'mongoose';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { MongooseConnection } from '@fluojs/mongoose';

const packageRoot = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

function readmeExample(file: string): string {
  const markdown = readFileSync(resolve(packageRoot, file), 'utf8');
  const examples = [...markdown.matchAll(/```ts\n([\s\S]*?)```/gu)]
    .flatMap((match) => match[1]?.includes('export class AdvancedRepository') ? [match[1]] : []);
  if (examples.length !== 1 || examples[0] === undefined) {
    throw new TypeError(`Expected one AdvancedRepository example in ${file}.`);
  }
  return examples[0];
}

function diagnostics(source: string): string {
  const sourcePath = resolve(packageRoot, 'src/manual-session-readme.ts');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ['node'],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === sourcePath
      ? ts.createSourceFile(path, source, languageVersion, true)
      : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);

  return ts.formatDiagnostics(ts.getPreEmitDiagnostics(ts.createProgram([sourcePath], options, host)), {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => packageRoot,
    getNewLine: () => '\n',
  });
}

function executableExample(source: string) {
  const compiled = ts.transpileModule(`${source}
export function run(conn: ConstructorParameters<typeof AdvancedRepository>[0]) {
  return new AdvancedRepository(conn).customOperation();
}
`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const exports = {};
  runInNewContext(compiled.outputText, { exports, require, TypeError });
  const run: unknown = Reflect.get(exports, 'run');
  if (typeof run !== 'function') {
    throw new TypeError('Expected an executable AdvancedRepository consumer.');
  }
  return run;
}

describe.each(['README.md', 'README.ko.md'])('%s manual session consumer', (file) => {
  it('AdvancedRepository: real public Mongoose types compile in strict mode', () => {
    const source = readmeExample(file);

    const errors = diagnostics(source);

    expect(errors).toBe('');
  });

  it.each(['native', 'absent'] as const)('customOperation: %s session preserves native query options', async (mode) => {
    const run = executableExample(readmeExample(file));
    const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017');
    const session = client.startSession();
    const connection = mongoose.createConnection();
    const User = connection.model('User', new mongoose.Schema({ status: String }));
    const query = User.find({ status: 'active' });
    const exec = vi.spyOn(query, 'exec').mockResolvedValue([]);
    const find = vi.spyOn(User, 'find').mockReturnValue(query);
    // Supply a real native session without connecting or claiming server commit/rollback evidence.
    const transaction = vi.spyOn(connection, 'transaction').mockImplementation(async (callback) => callback(session));
    const conn = new MongooseConnection(connection);

    try {
      if (mode === 'native') {
        await conn.transaction(async () => run(conn));
      } else {
        await run(conn);
      }

      expect(find).toHaveBeenCalledExactlyOnceWith({ status: 'active' });
      expect(exec).toHaveBeenCalledOnce();
      expect(query.getOptions().session).toBe(mode === 'native' ? session : null);
    } finally {
      transaction.mockRestore();
      find.mockRestore();
      exec.mockRestore();
      await session.endSession();
      await client.close();
      await connection.close();
    }
  });

  it('customOperation: non-native ambient session rejects before executing a query', async () => {
    const run = executableExample(readmeExample(file));
    const connection = mongoose.createConnection();
    const User = connection.model('User', new mongoose.Schema({ status: String }));
    const query = User.find({ status: 'active' });
    const exec = vi.spyOn(query, 'exec').mockResolvedValue([]);
    const find = vi.spyOn(User, 'find').mockReturnValue(query);
    const handle = {
      model: connection.model.bind(connection),
      startSession: async () => ({
        startTransaction() {},
        async commitTransaction() {},
        async abortTransaction() {},
        async endSession() {},
      }),
    };
    const conn = new MongooseConnection(handle);

    try {
      await expect(conn.transaction(async () => run(conn))).rejects.toThrow(TypeError);
      expect(find).not.toHaveBeenCalled();
    } finally {
      find.mockRestore();
      exec.mockRestore();
      await connection.close();
    }
  });
});
