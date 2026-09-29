import { ReactNavigationExperience, useRouterState } from '@fluojs/react/client';
import { createElement, type ReactNode } from 'react';

/** Exercise an application error-view override without changing the official page boundary. */
export function ExamplePageSlot({
  destination,
  page,
}: { readonly destination: ReactNode | null; readonly page: ReactNode }) {
  const route = useRouterState();
  return createElement(ReactNavigationExperience, {
    destination,
    page,
    ...(route.searchParams.get('throwFallback') === 'true'
      ? { renderError: () => { throw new Error('Example page error view failed'); } }
      : {}),
  });
}
