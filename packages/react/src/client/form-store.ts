import { submitHttpForm, type FormSubmission, type ReactFormMutation } from './form-transport.js';
import type { ReactRevalidationResult } from './types.js';
import type { ReactSessionChange } from '../form-result.js';

/** Follow-up reads do not change the already-confirmed persistence outcome. */
export type ReactFormFollowUp =
  | { readonly status: 'pending' }
  | ReactRevalidationResult
  | { readonly status: 'rejected'; readonly reason: 'unsupported-destination' };

/** Observable state of one native progressive form. */
export type ReactFormSnapshot<Data = unknown> = {
  readonly pending: boolean;
  readonly dirty: boolean;
  readonly skipped: number;
  readonly mutation: ReactFormMutation<Data> | null;
  readonly followUp: ReactFormFollowUp | null;
};

/** Provider-owned interaction with no queued or automatically repeated POST. */
export type ClientFormStore = {
  readonly getSnapshot: () => ReactFormSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly submit: (submission: FormSubmission, environment: FormEnvironment) => Promise<void>;
  readonly retryRead: () => Promise<void>;
  readonly cancel: () => void;
  readonly revoke: (keepSaved?: boolean) => void;
  readonly changed: () => void;
  readonly remember: () => void;
  readonly attach: (form: HTMLFormElement | null, owner?: object) => void;
  readonly release: (owner: object) => boolean;
  readonly unchanged: (name: string) => boolean;
  readonly canFocus: () => boolean;
};

/** Existing provider approval operations plus an application destination constraint. */
export type FormEnvironment = {
  readonly sessionChanged?: (change: ReactSessionChange) => Promise<boolean>;
  readonly authRejected?: (reason: 'unauthorized' | 'forbidden') => Promise<void>;
  readonly releaseSession?: () => void;
  readonly decodeSaved?: (value: unknown) => unknown;
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
  let transferred = false;
  let retained: readonly {
    readonly name: string;
    readonly value: string;
    readonly checked?: boolean;
    readonly selectedValues?: readonly string[];
  }[] = [];
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
    if (expected !== generation || controller.signal.aborted) return;
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
      const cancellation = new Promise<ReactFormMutation>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve({ status: 'uncertain', reason: 'cancelled' }), { once: true });
      });
      publish({ ...snapshot, pending: true, mutation: null, followUp: null });
      if (expected !== generation || controller.signal.aborted) return;
      store.remember();
      // A dispatched POST may persist before acknowledgement; discard older reads immediately.
      environment.invalidate();
      if (expected !== generation || controller.signal.aborted) return;
      // Cancellation settles local waiting even if a fetch/body reader ignores AbortSignal.
      let mutation = await Promise.race([submitHttpForm(submission, controller.signal), cancellation]);
      if (expected !== generation) return;
      if (mutation.status === 'saved' && environment.decodeSaved !== undefined) {
        try {
          mutation = { ...mutation, data: environment.decodeSaved(mutation.data) };
        } catch {
          mutation = { status: 'uncertain', reason: 'protocol' };
        }
      }
      snapshot = { ...snapshot, pending: false, mutation,
        followUp: mutation.status === 'saved' && mutation.session !== undefined ? { status: 'pending' } : null,
        dirty: mutation.status === 'saved' && inputRevision === submittedRevision ? false : snapshot.dirty,
      };
      if (mutation.status === 'saved' && mutation.session !== undefined && environment.sessionChanged !== undefined) {
        const continuation = environment.sessionChanged(mutation.session);
        publish(snapshot);
        if (!await Promise.race([continuation, cancellation.then(() => false)]) || expected !== generation) {
          if (expected === generation) publish({ ...snapshot, followUp: { status: 'cancelled' } });
          transferred = false;
          environment.releaseSession?.();
          return;
        }
      } else if (mutation.status === 'auth' && environment.authRejected !== undefined) {
        await Promise.race([environment.authRejected(mutation.reason), cancellation.then(() => {})]);
      }
      if (expected !== generation) return;
      active = null;
      publish(snapshot);
      if (mutation.status === 'saved') {
        // Also discard speculation admitted while the mutation was outstanding.
        environment.invalidate();
        if (expected !== generation) return;
        try {
          await read(mutation, environment);
        } finally {
          transferred = false;
          environment.releaseSession?.();
        }
      }
    },
    async retryRead() {
      if (snapshot.mutation?.status !== 'saved' || snapshot.followUp?.status === 'pending' || readEnvironment === null) return;
      await read(snapshot.mutation, readEnvironment);
    },
    cancel() {
      generation++;
      readEnvironment?.releaseSession?.();
      const controller = active;
      active = null;
      snapshot = {
        ...snapshot, pending: false,
        mutation: snapshot.pending ? { status: 'uncertain', reason: 'cancelled' } : snapshot.mutation,
        followUp: snapshot.followUp?.status === 'pending' ? { status: 'cancelled' } : snapshot.followUp,
      };
      controller?.abort();
      publish(snapshot);
    },
    revoke(keepSaved = false) {
      retained = [];
      focus = null;
      submittedValues = null;
      transferred = keepSaved;
      if (keepSaved) return;
      readEnvironment?.releaseSession?.();
      readEnvironment = null;
      store.cancel();
      publish({ ...snapshot, dirty: false,
        mutation: snapshot.mutation?.status === 'uncertain' || snapshot.mutation?.status === 'auth' ? snapshot.mutation : null,
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
          : control instanceof HTMLSelectElement && control.multiple
            ? [{ name: control.name, value: control.value,
              selectedValues: Array.from(control.selectedOptions, (option) => option.value) }]
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
      if (!transferred) store.cancel();
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
        if (control instanceof HTMLSelectElement && control.multiple && item.selectedValues !== undefined) {
          const selected = [...item.selectedValues];
          for (const option of control.options) {
            const selectedIndex = selected.indexOf(option.value);
            option.selected = selectedIndex !== -1;
            if (selectedIndex !== -1) selected.splice(selectedIndex, 1);
          }
        } else {
          control.value = item.value;
        }
        if (control instanceof HTMLInputElement && item.checked !== undefined) control.checked = item.checked;
        if (control.name === focus && next.ownerDocument.activeElement === next.ownerDocument.body) {
          control.focus({ preventScroll: true });
        }
      }
    },
  };
  return store;
}
