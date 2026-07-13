import { ReactServerFunctionConfigurationError } from './server-functions-errors.js';
import type { ReactServerFunctionReference } from './server-functions-types.js';

const actionIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const referencePattern = /^v1:([A-Za-z0-9_-]{1,128}):([a-f0-9]{64})$/;
const signaturePrefix = 'fluo.react.server-function.v1:';

type ReferenceSigner = {
  readonly createReference: (actionId: string) => Promise<ReactServerFunctionReference>;
  readonly verifyReference: (reference: string) => Promise<string | undefined>;
};

function toHex(value: ArrayBuffer): string {
  let result = '';
  for (const byte of new Uint8Array(value)) {
    result += byte.toString(16).padStart(2, '0');
  }
  return result;
}

function fromHex(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (value.length % 2 !== 0) {
    return undefined;
  }
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    const byte = Number.parseInt(value.slice(index, index + 2), 16);
    if (!Number.isInteger(byte)) {
      return undefined;
    }
    result[index / 2] = byte;
  }
  return result;
}

/**
 * Returns whether an action id is stable and safe to embed in the versioned reference format.
 *
 * @param value Candidate action id.
 * @returns Whether the id matches the bounded reference grammar.
 */
export function isReactServerFunctionActionId(value: string): boolean {
  return actionIdPattern.test(value);
}

/**
 * Creates the HMAC-SHA-256 action reference signer used by one registry.
 *
 * @param crypto Explicit runtime Web Crypto provider.
 * @param secret Application-owned secret snapshot.
 * @returns Reference issue and verification operations.
 */
export function createReactServerFunctionReferenceSigner(
  crypto: Pick<Crypto, 'subtle'>,
  secret: Uint8Array,
): ReferenceSigner {
  if (secret.byteLength < 32) {
    throw new ReactServerFunctionConfigurationError('Server Function HMAC secrets must contain at least 32 bytes.');
  }

  const encoder = new TextEncoder();
  const secretSnapshot = new Uint8Array(secret);
  const key = crypto.subtle.importKey(
    'raw',
    secretSnapshot,
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  );

  return {
    async createReference(actionId) {
      const signature = await crypto.subtle.sign(
        'HMAC',
        await key,
        encoder.encode(`${signaturePrefix}${actionId}`),
      );
      return Object.freeze({ value: `v1:${actionId}:${toHex(signature)}` });
    },
    async verifyReference(reference) {
      const match = referencePattern.exec(reference);
      const actionId = match?.[1];
      const signatureHex = match?.[2];
      if (actionId === undefined || signatureHex === undefined) {
        return undefined;
      }
      const signature = fromHex(signatureHex);
      if (signature === undefined) {
        return undefined;
      }
      const valid = await crypto.subtle.verify(
        'HMAC',
        await key,
        signature,
        encoder.encode(`${signaturePrefix}${actionId}`),
      );
      return valid ? actionId : undefined;
    },
  };
}
