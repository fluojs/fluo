import { AsyncLocalStorage } from 'node:async_hooks';

import { KonektiError } from '@konekti/core';

import type { RequestContext } from './types';

const requestContextStore = new AsyncLocalStorage<RequestContext>();

/**
 * 콜백을 요청 스코프 ALS 컨텍스트 안에서 실행한다.
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStore.run(context, callback);
}

/**
 * 현재 비동기 스코프에 활성화된 요청 컨텍스트가 있으면 반환한다.
 */
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}

/**
 * 현재 요청 컨텍스트를 반환하고, 활성 스코프가 없으면 예외를 던진다.
 */
export function assertRequestContext(): RequestContext {
  const context = getCurrentRequestContext();

  if (!context) {
    throw new KonektiError('RequestContext is not available in the current async scope.', {
      code: 'REQUEST_CONTEXT_MISSING',
    });
  }

  return context;
}

/**
 * ALS 저장에 안전하도록 요청 컨텍스트를 방어적으로 복사해 만든다.
 */
export function createRequestContext(context: RequestContext): RequestContext {
  return {
    ...context,
    metadata: { ...context.metadata },
  };
}
