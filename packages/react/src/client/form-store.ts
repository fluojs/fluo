import { submitHttpForm, type FormSubmission, type ReactFormMutation } from './form-transport.js';
import type { ReactRevalidationResult } from './types.js';

/** Follow-up reads do not change the already-confirmed persistence outcome. */
export type ReactFormFollowUp =
  | { readonly status: 'pending' }
  | ReactRevalidationResult
  | { readonly status: 'rejected'; readonly reason: 'unsupported-destination' };

/** Observable state of one native progressive form. */
export type ReactFormSnapshot = {
  readonly pending: boolean;
  readonly dirty: boolean;
  readonly skipped: number;
  readonly mutation: ReactFormMutation | null;
  readonly followUp: ReactFormFollowUp | null;
};

/** Provider-owned interaction with no queued or automatically repeated POST. */
export type ClientFormStore = {
  readonly getSnapshot: () => ReactFormSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly submit: (submission: FormSubmission, environment: FormEnvironment) => Promise<void>;
  readonly retryRead: () => Promise<void>;
  readonly cancel: () => void;
  readonly changed: () => void;
  readonly remember: () => void;
  readonly attach: (form: HTMLFormElement | null, owner?: object) => void;
  readonly release: (owner: object) => boolean;
  readonly unchanged: (name: string) => boolean;
  readonly canFocus: () => boolean;
};

/** Existing provider approval operations plus an application destination constraint. */
export type FormEnvironment = {
  readonly approve: (destination: string, followUp: 'refresh' | 'navigate', signal: AbortSignal) => Promise<ReactRevalidationResult>;
  readonly invalidate: () => void;
  readonly allowDestination: (destination: string, signal: AbortSignal) => boolean | Promise<boolean>;
  readonly rememberForms: () => void;
};

/**
 * Create one independent form state machine at the existing provider boundary.
 *
 * @returns A subscribable interaction with explicit cancellation and GET-only recovery.
 */
export function createClientFormStore(): ClientFormStore {
  let snapshot: ReactFormSnapshot = { pending: false, dirty: false, skipped: 0, mutation: null, followUp: null };
  let active: AbortController | null = null;
  let generation = 0;
  let inputRevision = 0;
  let submittedRevision = 0;
  let submittedValues: URLSearchParams | null = null;
  let readEnvironment: FormEnvironment | null = null;
  let form: HTMLFormElement | null = null;
  let owner: object | undefined;
  let retained: readonly { readonly name: string; readonly value: string; readonly checked?: boolean }[] = [];
  let focus: string | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: ReactFormSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const read = async (saved: Extract<ReactFormMutation, { status: 'saved' }>, environment: FormEnvironment): Promise<void> => {
    const expected = ++generation;
    const controller = new AbortController();
    active = controller;
    const abandoned = new Promise<boolean>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(false), { once: true });
    });
    publish({ ...snapshot, followUp: { status: 'pending' } });
    let allowed: boolean;
    try {
      allowed = await Promise.race([
        Promise.resolve(environment.allowDestination(saved.destination, controller.signal)), abandoned,
      ]);
    } catch {
      if (expected !== generation) return;
      active = null;
      publish({ ...snapshot, followUp: { status: 'error', failure: {
        destination: new URL(saved.destination).pathname, reason: 'application-error',
        type: saved.followUp === 'refresh' ? 'refresh' : 'push',
      } } });
      return;
    }
    if (expected !== generation) return;
    if (!allowed) {
      active = null;
      publish({ ...snapshot, followUp: { status: 'rejected', reason: 'unsupported-destination' } });
      return;
    }
    environment.rememberForms();
    let result: ReactRevalidationResult;
    try {
      result = await Promise.race([
        environment.approve(saved.destination, saved.followUp, controller.signal),
        abandoned.then(() => ({ status: 'cancelled' as const })),
      ]);
    } catch {
      result = { status: 'error', failure: {
        destination: new URL(saved.destination).pathname, reason: 'application-error',
        type: saved.followUp === 'refresh' ? 'refresh' : 'push',
      } };
    }
    if (expected !== generation) return;
    active = null;
    publish({ ...snapshot, followUp: result });
  };
  const store: ClientFormStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async submit(submission, environment) {
      if (snapshot.pending || snapshot.followUp?.status === 'pending') {
        publish({ ...snapshot, skipped: snapshot.skipped + 1 });
        return;
      }
      const expected = ++generation;
      submittedRevision = inputRevision;
      submittedValues = new URLSearchParams(submission.body);
      const controller = new AbortController();
      active = controller;
      readEnvironment = environment;
      publish({ ...snapshot, pending: true, mutation: null, followUp: null });
      store.remember();
      // A dispatched POST may persist before acknowledgement; discard older reads immediately.
      environment.invalidate();
      // Cancellation settles local waiting even if a fetch/body reader ignores AbortSignal.
      const cancellation = new Promise<ReactFormMutation>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve({ status: 'uncertain', reason: 'cancelled' }), { once: true });
      });
      const mutation = await Promise.race([submitHttpForm(submission, controller.signal), cancellation]);
      if (expected !== generation) return;
      active = null;
      publish({ ...snapshot, pending: false, mutation,
        dirty: mutation.status === 'saved' && inputRevision === submittedRevision ? false : snapshot.dirty,
      });
      if (mutation.status === 'saved') {
        // Also discard speculation admitted while the mutation was outstanding.
        environment.invalidate();
        await read(mutation, environment);
      }
    },
    async retryRead() {
      if (snapshot.mutation?.status !== 'saved' || snapshot.followUp?.status === 'pending' || readEnvironment === null) return;
      await read(snapshot.mutation, readEnvironment);
    },
    cancel() {
      generation++;
      active?.abort();
      active = null;
      publish({
        ...snapshot, pending: false,
        mutation: snapshot.pending ? { status: 'uncertain', reason: 'cancelled' } : snapshot.mutation,
        followUp: snapshot.followUp?.status === 'pending' ? { status: 'cancelled' } : snapshot.followUp,
      });
    },
    changed() {
      inputRevision++;
      store.remember();
      publish({ ...snapshot, dirty: true });
    },
    canFocus: () => inputRevision === submittedRevision,
    unchanged(name) {
      if (form === null || submittedValues === null) return true;
      const current = new FormData(form).getAll(name);
      const original = submittedValues.getAll(name);
      return current.length === original.length && current.every((value, index) =>
        typeof value === 'string' && value.replace(/\r?\n|\r/gu, '\r\n') === original[index]);
    },
    remember() {
      if (form === null) return;
      retained = Array.from(form.elements).flatMap((control) =>
        control instanceof HTMLInputElement && control.type !== 'file'
          ? [{ name: control.name, value: control.value, checked: control.checked }]
          : control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement
            ? [{ name: control.name, value: control.value }] : []);
      const activeElement = form.ownerDocument.activeElement;
      focus = activeElement instanceof HTMLElement && form.contains(activeElement)
        ? activeElement.getAttribute('name') : null;
    },
    release(releasingOwner) {
      if (owner !== releasingOwner) return false;
      owner = undefined;
      form = null;
      store.cancel();
      return true;
    },
    attach(next, nextOwner) {
      if (next === null && owner !== nextOwner) return;
      if (next !== null) owner = nextOwner;
      form = next;
      if (next === null) return;
      const remaining = [...retained];
      for (const control of next.elements) {
        if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) continue;
        const index = remaining.findIndex((item) => item.name === control.name);
        const item = remaining[index];
        if (item === undefined) continue;
        remaining.splice(index, 1);
        control.value = item.value;
        if (control instanceof HTMLInputElement && item.checked !== undefined) control.checked = item.checked;
        if (control.name === focus && next.ownerDocument.activeElement === next.ownerDocument.body) {
          control.focus({ preventScroll: true });
        }
      }
    },
  };
  return store;
}
