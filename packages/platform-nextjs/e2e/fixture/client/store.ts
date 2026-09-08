'use client';

import { createElement, useSyncExternalStore } from 'react';

// @store: this comment intentionally matches the legacy decorator content test.
const state = { message: 'FLUO_SSR_STORE_OK' };
const subscribe = () => () => {};
const snapshot = () => state;

export function StoreView() {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return createElement('output', { id: 'store' }, value.message);
}
