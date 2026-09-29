import {
  Component,
  createElement,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useRef,
} from 'react';

import { createReactPageMetadataElements } from '../page-metadata.js';
import { useNavigation, useRouter, useRouterState } from './hooks.js';
import { useClientNavigationStore } from './provider.js';
import type { ReactRouteSnapshot } from './types.js';

/** Application override for the official composition's post-approval focus and scroll. */
export type ReactNavigationEffect = (
  route: ReactRouteSnapshot,
  previous: ReactRouteSnapshot,
  previousScrollY: number,
) => void;

/** Props for the opt-in page slot within the persistent application shell. */
export type ReactNavigationExperienceProps = {
  readonly page: ReactNode;
  readonly destination: ReactNode | null;
  /** Replaces the default focus/scroll effect without changing the provider or router. */
  readonly onApprovedNavigation?: ReactNavigationEffect;
  /** Replaces the approved page's local render-error view; throwing here reaches the safe outer view. */
  readonly renderError?: (error: Error, reset: () => void) => ReactNode;
};

type BoundaryState = { readonly error: Error | null; readonly reset: number };

class PageRenderBoundary extends Component<{
  readonly children?: ReactNode;
  readonly renderError?: ReactNavigationExperienceProps['renderError'];
}, BoundaryState> {
  state: BoundaryState = { error: null, reset: 0 };

  static getDerivedStateFromError(error: Error): Pick<BoundaryState, 'error'> {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    console.error('React destination render failed', error);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      if (this.props.renderError !== undefined) {
        return this.props.renderError(this.state.error,
          () => this.setState(({ reset }) => ({ error: null, reset: reset + 1 })));
      }
      return createElement('section', { role: 'alert', 'aria-label': 'Page rendering failed' },
        createElement('h2', null, 'This page could not be displayed.'),
        createElement('button', {
          onClick: () => this.setState(({ reset }) => ({ error: null, reset: reset + 1 })),
          type: 'button',
        }, 'Try rendering this page again'),
      );
    }
    return createElement('div', { key: this.state.reset }, this.props.children);
  }
}

class SafePageBoundary extends Component<{ readonly children?: ReactNode }, { readonly error: boolean }> {
  state = { error: false };

  static getDerivedStateFromError(): { readonly error: boolean } {
    return { error: true };
  }

  override componentDidCatch(error: Error): void {
    console.error('React destination error view failed', error);
  }

  override render(): ReactNode {
    return this.state.error
      ? createElement('section', { role: 'alert', 'aria-label': 'Page error view failed' },
        createElement('h2', null, 'The page error view could not be displayed.'),
        createElement('a', { href: typeof window === 'undefined' ? '/' : window.location.href },
          'Open this page as a document'),
      )
      : this.props.children;
  }
}

function defaultApprovedNavigation(
  route: ReactRouteSnapshot,
  previous: ReactRouteSnapshot,
  previousScrollY: number,
  activatedFragment: boolean,
): void {
  if (activatedFragment && route.hash !== '' && route.hash !== previous.hash
    && route.pathname === previous.pathname
    && route.searchParams.toString() === previous.searchParams.toString()) {
    const target = document.getElementById(decodeURIComponent(route.hash.slice(1)));
    if (target instanceof HTMLElement
      && target.matches('a[href],button,input,select,textarea,[tabindex]')) {
      target.focus({ preventScroll: true });
    }
    return;
  }
  const main = document.querySelector('main');
  if (main instanceof HTMLElement) {
    main.focus({ preventScroll: true });
  }
  if (route.navigation.type !== 'back') {
    if (route.pathname !== previous.pathname) {
      window.scrollTo(0, 0);
    } else if (route.searchParams.toString() !== previous.searchParams.toString()) {
      window.scrollTo(0, previousScrollY);
    }
  }
}

/**
 * Compose pending, destination rendering and accessible navigation effects inside a persistent shell.
 *
 * @param props Application page and provider-approved destination, plus optional effect override.
 * @returns Status outside a keyed page slot, with the latest approved page kept during pending work.
 */
export function ReactNavigationExperience({
  page,
  destination,
  onApprovedNavigation,
  renderError,
}: ReactNavigationExperienceProps): ReactNode {
  const route = useRouterState();
  const navigation = useNavigation();
  const router = useRouter();
  const store = useClientNavigationStore();
  const retry = 'retry' in router && typeof router.retry === 'function' ? router.retry : undefined;
  const openDocument = 'openDocument' in router && typeof router.openDocument === 'function'
    ? router.openDocument : undefined;
  const previous = useRef(route);
  const previousScrollY = useRef(0);
  const fragmentIntent = useRef<string | undefined>(undefined);
  useEffect(() => store.subscribe(() => {
    const active = store.getSnapshot();
    if (active.navigation.status === 'navigating') {
      previousScrollY.current = window.scrollY;
      if (active.navigation.type === 'push' || active.navigation.type === 'replace') {
        fragmentIntent.current = active.navigation.destination;
      }
    } else if (active.navigation.status === 'complete' && active.url !== previous.current.url) {
      previousScrollY.current = window.scrollY;
    }
  }), [store]);
  useEffect(() => {
    if (route.url !== previous.current.url && navigation.status === 'complete') {
      if (onApprovedNavigation === undefined) {
        defaultApprovedNavigation(route, previous.current, previousScrollY.current,
          fragmentIntent.current === route.url);
      } else {
        onApprovedNavigation(route, previous.current, previousScrollY.current);
      }
      fragmentIntent.current = undefined;
    }
    if (navigation.status !== 'navigating') {
      previous.current = route;
    }
  }, [navigation.status, onApprovedNavigation, route]);

  const message = navigation.status === 'navigating'
    ? 'Loading page'
    : navigation.status === 'error'
      ? 'Navigation failed'
      : navigation.status === 'complete' ? 'Page ready' : '';

  return createElement('div', null,
    ...(route.metadata === undefined ? [] : createReactPageMetadataElements(route.metadata)),
    createElement('p', { 'aria-live': 'polite', role: 'status' }, message || '\u00a0'),
    navigation.status === 'error' && 'failure' in navigation && navigation.failure !== undefined
      ? createElement('div', { 'aria-label': 'Navigation recovery' },
        retry === undefined
          ? null
          : createElement('button', { onClick: retry, type: 'button' }, 'Retry navigation'),
        openDocument === undefined
          ? null
          : createElement('button', { onClick: openDocument, type: 'button' }, 'Open document'),
      ) : null,
    createElement('div', { id: 'page-slot' },
      createElement(SafePageBoundary, { key: route.url },
        createElement(PageRenderBoundary, { renderError }, destination ?? page),
      ),
    ),
  );
}
