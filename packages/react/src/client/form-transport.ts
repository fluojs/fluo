import { parseReactSessionChange, type ReactSessionChange } from '../form-result.js';

/** Safe, negotiated HTTP mutation acknowledgement; failures never imply rollback. */
export type ReactFormMutation<Data = unknown> =
  | { readonly status: 'read'; readonly data: Data }
  | { readonly status: 'error'; readonly reason: 'transport' | 'server' | 'protocol' | 'redirect' | 'cancelled' | 'input' }
  | { readonly status: 'saved'; readonly destination: string; readonly followUp: 'refresh' | 'navigate'; readonly data?: Data; readonly session?: ReactSessionChange }
  | { readonly status: 'validation'; readonly fieldErrors: Readonly<Record<string, readonly string[]>>; readonly formErrors: readonly string[] }
  | { readonly status: 'auth'; readonly reason: 'unauthorized' | 'forbidden' }
  | { readonly status: 'rejected'; readonly reason: 'input' }
  | { readonly status: 'uncertain'; readonly reason: 'transport' | 'server' | 'protocol' | 'redirect' | 'cancelled' };

const MEDIA_TYPE = 'application/vnd.fluo.form+json;v=1';

/** A captured browser successful-control set for one supported POST. */
export type FormSubmission = {
  readonly action: string;
  readonly body: URLSearchParams;
  readonly method?: 'get' | 'post';
};

/**
 * Resolve overrides before interception; undefined leaves the browser's submission untouched.
 *
 * @param form Native form.
 * @param submitter Browser-selected successful submit button.
 * @param actions Explicit application-authored same-origin action allowlist.
 * @param mode Navigation POST by default, or background GET/POST enhancement.
 * @returns A supported submission including duplicate names and submitter, or native fallback.
 */
export function captureFormSubmission(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  actions: readonly string[],
  mode: 'navigation' | 'background' = 'navigation',
): FormSubmission | undefined {
  if (!form.isConnected || form.ownerDocument.defaultView !== window
    || !form.noValidate && !submitter?.hasAttribute('formnovalidate') && !form.reportValidity()) return undefined;
  if (submitter !== null && !(submitter instanceof HTMLButtonElement && submitter.type === 'submit'
    || submitter instanceof HTMLInputElement && submitter.type === 'submit')) return undefined;
  const action = submitter?.getAttribute('formaction') ?? form.getAttribute('action') ?? window.location.href;
  const method = submitter?.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'get';
  const encoding = submitter?.getAttribute('formenctype') ?? form.getAttribute('enctype') ?? 'application/x-www-form-urlencoded';
  const target = submitter?.getAttribute('formtarget') ?? form.getAttribute('target')
    ?? form.ownerDocument.querySelector('base[target]')?.getAttribute('target') ?? '';
  const selectedMethod = method.toLowerCase();
  if (selectedMethod !== 'post' && !(mode === 'background' && selectedMethod === 'get')
    || encoding.toLowerCase() !== 'application/x-www-form-urlencoded'
    || target !== '' && target.toLowerCase() !== '_self') return undefined;
  let url: URL;
  try {
    url = new URL(action, form.ownerDocument.baseURI);
  } catch {
    return undefined;
  }
  if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)
    || url.username !== '' || url.password !== ''
    || !actions.some((allowed) => {
      try { return new URL(allowed, form.ownerDocument.baseURI).href === url.href; }
      catch { return false; }
    })) return undefined;
  const controls = new FormData(form, submitter);
  const body = new URLSearchParams();
  for (const [name, value] of controls) {
    if (typeof value !== 'string') return undefined;
    body.append(name.replace(/\r?\n|\r/gu, '\r\n'), value.replace(/\r?\n|\r/gu, '\r\n'));
  }
  return { action: url.href, body, ...(selectedMethod === 'get' ? { method: 'get' as const } : {}) };
}

function parseErrors(value: unknown): { fieldErrors: Readonly<Record<string, readonly string[]>>; formErrors: readonly string[] } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: unknown = Reflect.get(value, 'fieldErrors');
  const form: unknown = Reflect.get(value, 'formErrors');
  const messages = (items: unknown): items is readonly string[] => Array.isArray(items) && items.length <= 8
    && items.every((item: unknown) => typeof item === 'string' && item.length > 0 && item.length <= 256);
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields) || !messages(form)) return undefined;
  const entries = Object.entries(fields);
  if (entries.length > 32) return undefined;
  const fieldErrors: Record<string, readonly string[]> = Object.create(null);
  for (const [name, errors] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/u.test(name) || !messages(errors)) return undefined;
    fieldErrors[name] = [...errors];
  }
  return { fieldErrors, formErrors: [...form] };
}

/**
 * Send exactly one negotiated POST with browser-owned cookies and no automatic retry or replay.
 *
 * @param submission Captured supported native submission.
 * @param signal Cancellation of browser waiting, not persistence rollback.
 * @returns An explicit HTTP acknowledgement or conservative mutation outcome.
 */
export async function submitHttpForm(submission: FormSubmission, signal: AbortSignal): Promise<ReactFormMutation> {
  const reading = submission.method === 'get';
  const failure = (reason: 'transport' | 'server' | 'protocol' | 'redirect' | 'cancelled'): ReactFormMutation =>
    reading ? { status: 'error', reason } : { status: 'uncertain', reason };
  try {
    const requestUrl = new URL(submission.action);
    if (reading) requestUrl.search = submission.body.toString();
    const response = await fetch(requestUrl.href, {
      method: reading ? 'GET' : 'POST', ...(reading ? {} : { body: submission.body }), signal,
      credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      headers: { Accept: reading ? 'application/json' : MEDIA_TYPE },
    });
    if (signal.aborted) return failure('cancelled');
    if (response.status === 401 || response.status === 403) {
      return { status: 'auth', reason: response.status === 401 ? 'unauthorized' : 'forbidden' };
    }
    if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400 || response.redirected) {
      return failure('redirect');
    }
    if (response.status >= 500) return failure('server');
    const media = response.headers.get('Content-Type')?.toLowerCase().replaceAll('"', '').split(';')
      .map((part) => part.trim());
    if (reading) {
      if (!response.ok) return { status: 'error', reason: response.status === 400 || response.status === 422 ? 'input' : 'protocol' };
      if (media?.[0] !== 'application/json') return failure('protocol');
      const text = await response.text();
      if (signal.aborted) return failure('cancelled');
      if (new TextEncoder().encode(text).byteLength > 524_288) return failure('protocol');
      try { return { status: 'read', data: JSON.parse(text) }; }
      catch { return failure('protocol'); }
    }
    if (media?.[0] !== 'application/vnd.fluo.form+json' || !media.includes('v=1')) {
      return response.status === 400 || response.status === 422
        ? { status: 'rejected', reason: 'input' } : { status: 'uncertain', reason: 'protocol' };
    }
    const text = await response.text();
    if (signal.aborted) return { status: 'uncertain', reason: 'cancelled' };
    // Covers the HTTP projection's maximum JSON-escaped message/key budget.
    if (new TextEncoder().encode(text).byteLength > 524_288) return { status: 'uncertain', reason: 'protocol' };
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { status: 'uncertain', reason: 'protocol' };
    }
    if (typeof payload !== 'object' || payload === null || Reflect.get(payload, 'version') !== 1) {
      return { status: 'uncertain', reason: 'protocol' };
    }
    if (Reflect.get(payload, 'outcome') === 'validation' && (response.status === 400 || response.status === 422)) {
      const errors = parseErrors(payload);
      return errors === undefined ? { status: 'uncertain', reason: 'protocol' } : { status: 'validation', ...errors };
    }
    const destination: unknown = Reflect.get(payload, 'destination');
    const followUp: unknown = Reflect.get(payload, 'followUp');
    if (!response.ok || Reflect.get(payload, 'outcome') !== 'saved' || typeof destination !== 'string'
      || followUp !== 'refresh' && followUp !== 'navigate') return { status: 'uncertain', reason: 'protocol' };
    const url = new URL(destination, submission.action);
    if (url.origin !== new URL(submission.action).origin || !['http:', 'https:'].includes(url.protocol)
      || url.username !== '' || url.password !== '') return { status: 'uncertain', reason: 'protocol' };
    const explicitSession: unknown = Reflect.get(payload, 'session');
    const session = parseReactSessionChange(explicitSession);
    if (Object.hasOwn(payload, 'session') && session === undefined) return { status: 'uncertain', reason: 'protocol' };
    return { status: 'saved', destination: url.href, followUp,
      ...(Object.hasOwn(payload, 'data') ? { data: Reflect.get(payload, 'data') } : {}),
      ...(session === undefined ? {} : { session }),
    };
  } catch {
    return failure(signal.aborted ? 'cancelled' : 'transport');
  }
}
