import { createElement, useState } from 'react';
import { Link, useForm, useRouter, useRouterState } from '@fluojs/react/client';
import type { ReactNode } from 'react';

/** Ordinary HTTP session forms in the persistent shell, outside revoked protected pages. */
export function SessionControls() {
  const router = useRouter();
  const route = useRouterState();
  const [operation, setOperation] = useState('');
  const options = {
    fields: { identity: 'identity' },
    allowDestination: (destination: string) => {
      const url = new URL(destination);
      return url.origin === window.location.origin
        && ['/catalog/session', '/catalog/session/protected'].includes(url.pathname);
    },
  };
  const login = useForm<{ identity: string }>({ ...options, id: 'session-login', action: '/catalog/session/login' });
  const logout = useForm<{ identity: string }>({ ...options, id: 'session-logout', action: '/catalog/session/logout' });
  const permissions = useForm<{ identity: string }>({ ...options, id: 'session-permissions', action: '/catalog/session/permissions' });
  return createElement('section', { 'aria-label': 'Session controls', style: { overflowWrap: 'anywhere' } },
    createElement('p', null, createElement('output', { 'data-session-state': true },
      `${route.session?.epoch ?? 'initial'}:${route.session?.generation ?? 0}:${route.session?.status ?? 'approved'}`)),
    createElement('p', null, createElement('output', { 'data-session-operation': true }, operation)),
    createElement('p', null, createElement('output', { 'data-session-url': true }, `${route.url}:${JSON.stringify(route.params)}`)),
    createElement('form', { ...login.formProps, 'aria-label': 'Session login', 'data-enhanced': String(login.connected) },
      createElement('input', { type: 'hidden', name: 'csrf', value: 'catalog-demo-token' }),
      createElement('button', { type: 'submit', name: 'identity', value: 'a' }, 'Login A'),
      createElement('button', { type: 'submit', name: 'identity', value: 'b' }, 'Login B')),
    createElement('form', { ...logout.formProps, 'aria-label': 'Session logout' },
      createElement('input', { type: 'hidden', name: 'csrf', value: 'catalog-demo-token' }),
      createElement('button', { type: 'submit' }, 'Logout HTTP')),
    createElement('form', { ...permissions.formProps, 'aria-label': 'Session permissions' },
      createElement('input', { type: 'hidden', name: 'csrf', value: 'catalog-demo-token' }),
      createElement('button', { type: 'submit' }, 'Revoke permissions')),
    createElement('output', { 'data-permission-result': true },
      `${permissions.state.mutation?.status ?? 'idle'}:${permissions.state.followUp?.status ?? 'idle'}`),
    createElement('button', { type: 'button', onClick: () => {
      void router.sessionChanged({ epoch: 'demo:explicit-out', reason: 'logout' }).then((result) => setOperation(`logout:${result.status}`));
    } }, 'Notify logout'),
    createElement('button', { type: 'button', onClick: () => {
      void router.sessionChanged({ epoch: 'demo:explicit-in', reason: 'login' }).then((result) => setOperation(`login:${result.status}`));
    } }, 'Notify login'),
    createElement('button', { type: 'button', onClick: () => {
      void router.refresh().then((result) => {
        document.dispatchEvent(new CustomEvent('session-operation', { detail: { operation: 'refresh', status: result.status } }));
        setOperation(`refresh:${result.status}`);
      });
    } }, 'Session refresh'),
    createElement(Link, { href: '/catalog/session/protected?speculative=1', prefetch: 'hover' }, 'Speculate protected'),
    createElement(Link, { href: '/catalog/session/protected?view=next' }, 'Session soft page'),
  );
}

/** Authentication resource lifetime remains owned by the application's existing React subtree. */
export function SessionResources({ children }: { readonly children: ReactNode }) {
  const session = useRouterState().session;
  return session === undefined || session.status === 'approved' ? children : null;
}
