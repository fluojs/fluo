import { useCallback, useEffect, useRef, useSyncExternalStore, type FormEvent } from 'react';
import { createClientFormStore, type ReactFormSnapshot } from './form-store.js';
import { captureFormSubmission } from './form-transport.js';
import { useClientNavigationStore } from './provider.js';

/** Typed DTO fields mapped to authored successful-control names, without a client DTO validator. */
export type ReactFormOptions<Input extends object> = {
  readonly id: string;
  readonly action: string;
  readonly actions?: readonly string[];
  readonly fields: Readonly<Record<keyof Input, string>>;
  /** Application policy after HTTP success; an obsolete asynchronous decision cannot navigate. */
  readonly allowDestination: (destination: string, signal: AbortSignal) => boolean | Promise<boolean>;
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};

/** One canonical progressive native form binding, with typed authored input/error access. */
export type ReactFormBinding<Input extends object> = {
  /** True only after the existing provider has connected to the browser. */
  readonly connected: boolean;
  readonly state: ReactFormSnapshot;
  readonly formProps: {
    readonly id: string;
    readonly action: string;
    readonly method: 'post';
    readonly encType: 'application/x-www-form-urlencoded';
    readonly ref: (element: HTMLFormElement | null) => void;
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    readonly onInput: () => void;
  };
  /** Read only the requested DTO field's safe messages. */
  readonly fieldErrors: (field: keyof Input & string) => readonly string[];
  /** Read browser-owned successful values using a typed DTO field name. */
  readonly values: (field: keyof Input & string) => readonly string[];
  /** Associate authored controls with the corresponding DTO errors and accessible error element. */
  readonly fieldProps: (field: keyof Input & string) => {
    readonly id: string;
    readonly name: string;
    readonly 'aria-invalid': boolean;
    readonly 'aria-describedby': string | undefined;
  };
  /** Cancel waiting; an already-dispatched mutation may still persist. */
  readonly cancel: () => void;
  /** Recover a confirmed save by repeating GET approval only. */
  readonly retryRead: () => Promise<void>;
};

/**
 * Enhance one ordinary HTTP form through its existing React router provider.
 *
 * @param options Stable form identity, DTO-to-control names, supported actions and destination policy.
 * @returns Native form attributes, independent state, safe field associations and read-only recovery.
 */
export function useForm<Input extends object>(
  options: ReactFormOptions<Input>,
): ReactFormBinding<Input> {
  const navigation = useClientNavigationStore();
  const route = navigation.getSnapshot();
  const key = `${route.url.split('#', 1)[0]}\0${options.id}`;
  let interaction = navigation.forms.get(key);
  if (interaction === undefined) {
    interaction = createClientFormStore();
    navigation.forms.set(key, interaction);
  }
  const form = interaction;
  const element = useRef<HTMLFormElement | null>(null);
  const owner = useRef({});
  const currentFields = useRef(options.fields);
  currentFields.current = options.fields;
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot, form.getSnapshot);
  const connected = useSyncExternalStore(navigation.subscribe, navigation.isConnected, () => false);
  const ref = useCallback((node: HTMLFormElement | null): void => {
    element.current = node;
    form.attach(node, owner.current);
  }, [form]);
  useEffect(() => () => {
    if (form.release(owner.current) && navigation.forms.get(key) === form) navigation.forms.delete(key);
  }, [form, key, navigation]);
  const fieldErrors = (field: keyof Input & string): readonly string[] =>
    state.mutation?.status === 'validation' && form.unchanged(options.fields[field])
      ? state.mutation.fieldErrors[field] ?? [] : [];
  useEffect(() => {
    if (state.mutation?.status !== 'validation' || element.current === null || !form.canFocus()) return;
    const current = element.current;
    // A late result for another form never takes focus from the user's current control.
    if (!current.contains(current.ownerDocument.activeElement)) return;
    const names: Readonly<Record<string, string>> = currentFields.current;
    for (const field of Object.keys(names)) {
      if ((state.mutation.fieldErrors[field]?.length ?? 0) === 0) continue;
      const name = names[field];
      if (name === undefined || !form.unchanged(name)) continue;
      const control = Array.from(current.elements).find((candidate) =>
        candidate instanceof HTMLElement && candidate.getAttribute('name') === name);
      if (control instanceof HTMLElement) control.focus({ preventScroll: true });
      break;
    }
  }, [form, state.mutation]);
  return {
    connected,
    state,
    formProps: {
      id: options.id, action: options.action, method: 'post', encType: 'application/x-www-form-urlencoded', ref,
      onInput: form.changed,
      onSubmit(event) {
        options.onSubmit?.(event);
        if (event.defaultPrevented || !connected) return;
        if (navigation.getSnapshot().url.split('#', 1)[0]
          !== `${window.location.pathname}${window.location.search}`) return;
        const nativeEvent = event.nativeEvent;
        const selected: unknown = Reflect.get(nativeEvent, 'submitter');
        const submitter = selected instanceof HTMLElement ? selected : null;
        const submission = captureFormSubmission(event.currentTarget, submitter, options.actions ?? [options.action]);
        if (submission === undefined) return;
        event.preventDefault();
        void form.submit(submission, {
          invalidate: navigation.router.invalidate,
          approve: navigation.approveForm,
          allowDestination: options.allowDestination,
          rememberForms: () => { for (const other of navigation.forms.values()) other.remember(); },
        });
      },
    },
    fieldErrors,
    values(field) {
      return element.current === null ? [] : new FormData(element.current)
        .getAll(options.fields[field]).filter((value): value is string => typeof value === 'string');
    },
    fieldProps(field) {
      const id = `${options.id}-${field}`;
      const invalid = fieldErrors(field).length > 0;
      return { id, name: options.fields[field], 'aria-invalid': invalid,
        'aria-describedby': invalid ? `${id}-errors` : undefined };
    },
    cancel: form.cancel,
    retryRead: form.retryRead,
  };
}
