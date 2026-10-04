import type { TypegenGenerationMessage } from './typegen-generation-protocol.js';
import { createProcessIsolatedTypegenSource } from './typegen-isolated-source.js';
import type { ParsedTypegenArgs } from './typegen-options.js';
import { TypegenCommandError } from './typegen-options.js';

function readGenerationArgs(): { readonly cwd: string; readonly exportName: string; readonly modulePath: string; readonly options: Partial<ParsedTypegenArgs> } {
  const [cwd, modulePath, exportName, encoded] = process.argv.slice(2);
  if (cwd === undefined || modulePath === undefined || exportName === undefined) {
    throw new TypegenCommandError('Typegen generation process received incomplete arguments.');
  }
  const options: unknown = encoded === undefined ? {} : JSON.parse(encoded);
  if (typeof options !== 'object' || options === null) throw new TypegenCommandError('Generation options are malformed.');
  const parsed: Partial<ParsedTypegenArgs> = {};
  for (const key of ['outputPath', 'optionsExport', 'tsconfigPath'] as const) {
    const value: unknown = Reflect.get(options, key);
    if (value !== undefined && typeof value !== 'string') throw new TypegenCommandError(`Generation ${key} is malformed.`);
    if (typeof value === 'string') Object.defineProperty(parsed, key, { enumerable: true, value });
  }
  return { cwd, exportName, modulePath, options: parsed };
}

function sendGenerationMessage(message: TypegenGenerationMessage): Promise<void> {
  if (process.send === undefined) {
    throw new TypegenCommandError('Typegen generation process requires an IPC channel.');
  }
  const send = process.send.bind(process);
  return new Promise((resolve, reject) => {
    send(message, (error) => {
      if (error === null) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function runGenerationChild(): Promise<void> {
  let message: TypegenGenerationMessage;
  try {
    const request = readGenerationArgs();
    const parsed: ParsedTypegenArgs = {
      check: false,
      exportName: request.exportName,
      modulePath: request.modulePath,
      outputPath: '',
      watch: false,
      ...request.options,
    };
    message = {
      kind: 'source',
      source: await createProcessIsolatedTypegenSource(parsed, request.cwd),
    };
  } catch (error: unknown) {
    process.exitCode = 1;
    message = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await sendGenerationMessage(message);
  } finally {
    if (process.connected) {
      process.disconnect();
    }
  }
}

await runGenerationChild();
