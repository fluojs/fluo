import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useClientNavigationStore } from './provider.js';
import type { ReactNavigationType } from './types.js';

/** A same-document intent; its destination belongs to the application, not HTTP approval. */
export type ReactNavigationIntent = {
  readonly destination: string;
  readonly type: ReactNavigationType;
};

/** One current permission boundary. Old callbacks lose authority before cancellation signals fire. */
export type ReactNavigationDecision = {
  readonly intent: ReactNavigationIntent;
  readonly signal: AbortSignal;
  /** Approve only this captured intent, never a newer one or a new session. */
  readonly proceed: () => void;
  /** Stay without HTTP, form cancellation, transport failure or document fallback. */
  readonly stay: () => void;
};

/** Combine protected inputs and work in one application-owned decision owner. */
export type ReactNavigationGuardOptions = {
  readonly when: boolean;
  /** Optional bounded asynchronous decision; rejection stays on the approved page. */
  readonly confirm?: (intent: ReactNavigationIntent, signal: AbortSignal) => boolean | Promise<boolean>;
  /** Opt into the browser's separate, synchronous document-exit prompt. */
  readonly beforeUnload?: boolean;
};

/**
 * Protect navigation through the existing provider without reconnecting its session or forms.
 *
 * @param options App-owned dirty/pending condition and optional decision/document policies.
 * @returns The current intent's controls, or null when no permission is pending.
 */
export function useNavigationGuard(options: ReactNavigationGuardOptions): ReactNavigationDecision | null {
  const store = useClientNavigationStore();
  const current = useRef(options);
  current.current = options;
  useEffect(() => store.registerNavigationGuard(() => current.current), [store]);
  useEffect(() => {
    if (!options.beforeUnload || !options.when) return;
    const warn = (event: BeforeUnloadEvent): void => {
      const session = store.getSnapshot().session;
      if (!current.current.when || session !== undefined && session.status !== 'approved') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [options.beforeUnload, options.when, store]);
  return useSyncExternalStore(store.subscribe, store.getNavigationDecision, () => null);
}
