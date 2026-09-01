import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import type {
  FrameworkRequest,
  FrameworkResponse,
  FrameworkResponseStream,
  RequestContext,
} from '../index.js';
import { Controller, createDispatcher, createHandlerMapping, Sse, SseResponse } from '../index.js';

interface ManualSseStream extends FrameworkResponseStream {
  closeCalls: number;
  removeCloseListenerCalls: number;
}

interface ManualSseFixture {
  readonly abortController: AbortController;
  readonly dispatch: Promise<void>;
  readonly events: string[];
  readonly sse: Promise<SseResponse>;
  readonly stream: ManualSseStream;
}

interface CloseCase {
  readonly close: (fixture: ManualSseFixture) => Promise<void>;
  readonly label: string;
}

const CLOSE_CASES = [
  {
    async close(fixture: ManualSseFixture): Promise<void> {
      (await fixture.sse).close();
    },
    label: 'the controller closes it normally',
  },
  {
    async close(fixture: ManualSseFixture): Promise<void> {
      fixture.abortController.abort(new Error('client disconnected'));
    },
    label: 'the request aborts',
  },
] as const satisfies readonly CloseCase[];

class LifecycleContainer extends Container {
  constructor(private readonly events: string[]) {
    super();
  }

  override createRequestScope(): Container {
    const scope = super.createRequestScope();
    const dispose = scope.dispose.bind(scope);

    scope.dispose = async () => {
      this.events.push('dispose');
      await dispose();
    };

    return scope;
  }
}

function createRequest(signal: AbortSignal): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/events',
    query: {},
    raw: {},
    signal,
    url: '/events',
  };
}

function createResponse(stream: ManualSseStream): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
    stream,
  };
}

function createStream(): ManualSseStream {
  let closed = false;
  let closeListener: (() => void) | undefined;

  return {
    close() {
      if (closed) {
        return;
      }

      closed = true;
      this.closeCalls += 1;
      closeListener?.();
    },
    closeCalls: 0,
    get closed() {
      return closed;
    },
    onClose(listener) {
      closeListener = listener;

      return () => {
        this.removeCloseListenerCalls += 1;
        closeListener = undefined;
      };
    },
    removeCloseListenerCalls: 0,
    write() {
      return true;
    },
  };
}

function createFixture(): ManualSseFixture {
  const abortController = new AbortController();
  const events: string[] = [];
  const stream = createStream();
  const response = createResponse(stream);
  let resolveSse: (sse: SseResponse) => void = () => undefined;
  const sse = new Promise<SseResponse>((resolve) => {
    resolveSse = resolve;
  });

  @Controller('/events')
  class ManualSseController {
    @Sse('/')
    stream(_input: undefined, context: RequestContext): SseResponse {
      const response = new SseResponse(context);

      events.push('handler');
      resolveSse(response);
      return response;
    }
  }

  const root = new LifecycleContainer(events).register(ManualSseController);
  const dispatcher = createDispatcher({
    handlerMapping: createHandlerMapping([{ controllerToken: ManualSseController }]),
    observers: [
      {
        onRequestFinish() {
          events.push('finish');
        },
        onRequestSuccess() {
          events.push('success');
        },
      },
    ],
    rootContainer: root,
  });

  return {
    abortController,
    dispatch: dispatcher.dispatch(createRequest(abortController.signal), response),
    events,
    sse,
    stream,
  };
}

describe('manual SSE lifecycle', () => {
  it.each(CLOSE_CASES)(
    'keeps request lifecycle resources active until $label',
    async ({ close }) => {
      // Given
      const fixture = createFixture();

      // When
      await fixture.sse;
      await new Promise<void>(setImmediate);

      // Then
      expect(fixture.events).toEqual(['handler']);

      await close(fixture);
      await fixture.dispatch;

      expect(fixture.events).toEqual(['handler', 'success', 'finish', 'dispose']);
      expect(fixture.stream.closeCalls).toBe(1);
      expect(fixture.stream.removeCloseListenerCalls).toBe(1);
    },
  );
});
