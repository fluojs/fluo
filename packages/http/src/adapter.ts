import type { MaybePromise } from '@konekti/core';

import type { Dispatcher } from './types.js';

/**
 * 애플리케이션 라이프사이클과 실제 전송 계층을 연결하는 최소 HTTP 어댑터 계약이다.
 */
export interface HttpApplicationAdapter {
  getServer?(): unknown;
  listen(dispatcher: Dispatcher): MaybePromise<void>;
  close(signal?: string): MaybePromise<void>;
}

/**
 * 아직 실제 HTTP 바인딩이 없을 때도 라이프사이클 계약을 유지할 수 있게 하는 기본 어댑터다.
 */
export function createNoopHttpApplicationAdapter(): HttpApplicationAdapter {
  return {
    async close() {},
    async listen() {},
  };
}
