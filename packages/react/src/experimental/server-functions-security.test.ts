import type { FrameworkRequest, RequestContext } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import {
  createReactServerFunctionRegistry,
  REACT_SERVER_FUNCTION_ERROR_CODES,
  REACT_SERVER_FUNCTION_REQUEST_HEADER,
  ReactServerFunctionConfigurationError,
  type ReactServerFunctionReference,
} from './rsc.js';

const encoder = new TextEncoder();
const secret = new Uint8Array(32).fill(11);

function createContext(input: {
  readonly body: unknown;
  readonly rawBody?: Uint8Array;
  readonly reference?: ReactServerFunctionReference;
  readonly headers?: Readonly<Record<string, string>>;
}): RequestContext {
  const body = input.reference ? { action: input.reference.value, args: [] } : input.body;
  const request: FrameworkRequest = {
    body,
    cookies: {},
    headers: {
      'content-type': 'application/json',
      origin: 'https://app.example.com',
      [REACT_SERVER_FUNCTION_REQUEST_HEADER]: '1',
      ...input.headers,
    },
    method: 'POST',
    params: {},
    path: '/_fluo/actions',
    query: {},
    raw: {},
    rawBody: input.rawBody ?? encoder.encode(JSON.stringify(body)),
    url: '/_fluo/actions',
  };
  return {
    container: {
      async dispose() {},
      async resolve() {
        throw new TypeError('No request-scoped providers are registered in this unit test.');
      },
    },
    metadata: {},
    request,
    response: {
      committed: false,
      headers: {},
      redirect() {},
      send() {},
      setHeader() {},
      setStatus() {},
    },
  };
}

async function expectRejection(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code, status });
}

describe('experimental React Server Function security boundary', () => {
  it.each([
    ['empty', ''],
    ['invalid-character', 'invalid/action'],
    ['over-128-character', 'a'.repeat(129)],
  ])('rejects the %s action id deterministically', (_caseName, actionId) => {
    // Given: a registry configuration containing one action id outside the documented grammar.
    const createRegistry = () => createReactServerFunctionRegistry({
      actions: { [actionId]: () => ({ ok: true }) },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      secret,
    });

    // When/Then: registry construction rejects with the stable configuration error and message.
    expect(createRegistry).toThrowError(ReactServerFunctionConfigurationError);
    expect(createRegistry).toThrowError(
      `Server Function action id "${actionId}" must match [A-Za-z0-9_-] and contain 1 to 128 characters.`,
    );
  });

  it('rejects a tampered action reference without revealing registry membership', async () => {
    // Given: one registered action and its signed reference.
    const registry = createReactServerFunctionRegistry({
      actions: { known: () => ({ ok: true }) },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      secret,
    });
    const reference = await registry.createReference('known');
    const finalCharacter = reference.value.at(-1);
    const tampered = { value: `${reference.value.slice(0, -1)}${finalCharacter === '0' ? '1' : '0'}` };

    // When: an attacker changes the opaque action reference.
    const invocation = registry.invoke(createContext({ body: undefined, reference: tampered }));

    // Then: the boundary returns the same not-found semantics used for invalid actions.
    await expectRejection(invocation, 404, REACT_SERVER_FUNCTION_ERROR_CODES.actionNotFound);
  });

  it('rejects a validly signed reference for an action absent from the active registry', async () => {
    // Given: two registry snapshots share a secret but only the issuer contains the retired action.
    const issuer = createReactServerFunctionRegistry({
      actions: { retired: () => ({ ok: true }) },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      secret,
    });
    const active = createReactServerFunctionRegistry({
      actions: { current: () => ({ ok: true }) },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      secret,
    });
    const retiredReference = await issuer.createReference('retired');

    // When: a caller sends the retired but untampered reference to the active registry.
    const invocation = active.invoke(createContext({ body: undefined, reference: retiredReference }));

    // Then: unknown and tampered references share the same not-found response.
    await expectRejection(invocation, 404, REACT_SERVER_FUNCTION_ERROR_CODES.actionNotFound);
  });

  it('rejects malformed and unsafe serialized arguments deterministically', async () => {
    // Given: a valid registry and reference.
    const registry = createReactServerFunctionRegistry({
      actions: { known: () => ({ ok: true }) },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      secret,
    });
    const reference = await registry.createReference('known');
    const malformed = createContext({ body: '{', rawBody: encoder.encode('{') });
    const unsafe = createContext({
      body: { action: reference.value, args: [Number.NaN] },
      rawBody: encoder.encode(`{"action":"${reference.value}","args":[null]}`),
    });

    // When/Then: malformed request shapes and non-JSON values use the stable 400 code.
    await expectRejection(
      registry.invoke(malformed),
      400,
      REACT_SERVER_FUNCTION_ERROR_CODES.invalidRequest,
    );
    await expectRejection(
      registry.invoke(unsafe),
      400,
      REACT_SERVER_FUNCTION_ERROR_CODES.argumentSerializationFailed,
    );
  });

  it('enforces body-size, origin, content-type, and CSRF marker policies before invocation', async () => {
    // Given: a registry with a deliberately small request limit.
    let invocationCount = 0;
    const registry = createReactServerFunctionRegistry({
      actions: {
        known() {
          invocationCount += 1;
          return { ok: true };
        },
      },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      maxBodyBytes: 1024,
      secret,
    });
    const reference = await registry.createReference('known');

    // When/Then: every transport policy fails before the action executes.
    await expectRejection(
      registry.invoke(createContext({ body: undefined, rawBody: new Uint8Array(1025), reference })),
      413,
      REACT_SERVER_FUNCTION_ERROR_CODES.payloadTooLarge,
    );
    await expectRejection(
      registry.invoke(createContext({
        body: undefined,
        headers: { origin: 'https://attacker.example' },
        reference,
      })),
      403,
      REACT_SERVER_FUNCTION_ERROR_CODES.originRejected,
    );
    await expectRejection(
      registry.invoke(createContext({
        body: undefined,
        headers: { 'content-type': 'text/plain' },
        reference,
      })),
      415,
      REACT_SERVER_FUNCTION_ERROR_CODES.unsupportedMediaType,
    );
    await expectRejection(
      registry.invoke(createContext({
        body: undefined,
        headers: { [REACT_SERVER_FUNCTION_REQUEST_HEADER]: '0' },
        reference,
      })),
      403,
      REACT_SERVER_FUNCTION_ERROR_CODES.csrfRejected,
    );
    expect(invocationCount).toBe(0);
  });

  it('rejects an unsafe action result with a stable server-side serialization failure', async () => {
    // Given: an action whose numeric type hides a non-JSON runtime value.
    const registry = createReactServerFunctionRegistry({
      actions: { unsafe: () => Number.NaN },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      secret,
    });
    const reference = await registry.createReference('unsafe');

    // When: the action result crosses the response serialization boundary.
    const invocation = registry.invoke(createContext({ body: undefined, reference }));

    // Then: the invalid result is not returned to the caller.
    await expectRejection(
      invocation,
      500,
      REACT_SERVER_FUNCTION_ERROR_CODES.resultSerializationFailed,
    );
  });
});
