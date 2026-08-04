import { TypegenCommandError } from './typegen-options.js';

/** IPC outcome emitted by one isolated typegen generation child. */
export type TypegenGenerationMessage =
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'source'; readonly source: string };

/**
 * Parses an untrusted generation child IPC payload.
 *
 * @param value IPC payload received from the child process.
 * @returns A validated source or error message.
 */
export function parseTypegenGenerationMessage(value: unknown): TypegenGenerationMessage {
  if (typeof value !== 'object' || value === null) {
    throw new TypegenCommandError('Typegen generation process returned an invalid IPC message.');
  }
  const kind = Reflect.get(value, 'kind');
  if (kind === 'error') {
    const message = Reflect.get(value, 'message');
    if (typeof message === 'string') {
      return { kind, message };
    }
  }
  if (kind === 'source') {
    const source = Reflect.get(value, 'source');
    if (typeof source === 'string') {
      return { kind, source };
    }
  }
  throw new TypegenCommandError('Typegen generation process returned an invalid IPC message.');
}
