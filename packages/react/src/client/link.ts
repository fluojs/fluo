import {
  type AnchorHTMLAttributes,
  createElement,
  type MouseEvent,
  type ReactElement,
  useEffect,
  useRef,
} from 'react';

import { useClientNavigationStore } from './provider.js';

/** Props accepted by the progressive-enhancement-friendly client navigation anchor. */
export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  readonly href: string | URL;
  /** Opt in to an anonymous, server-granted single-use navigation prefetch. */
  readonly prefetch?: 'hover' | 'viewport';
};

function hasNavigationModifier(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

/**
 * Render a real anchor that upgrades same-origin primary clicks after hydration.
 *
 * @param props Anchor props plus a required navigation destination.
 * @returns A semantic anchor that falls back to ordinary document navigation without JavaScript.
 */
export function Link({
  children,
  href,
  onClick,
  onPointerEnter,
  onPointerLeave,
  prefetch,
  target,
  ...anchorProps
}: LinkProps): ReactElement {
  const store = useClientNavigationStore();
  const hrefValue = String(href);
  const anchor = useRef<HTMLAnchorElement>(null);
  const hoverOwner = useRef<object>({});
  const viewportOwner = useRef<object>({});
  const eligible = (): boolean =>
    anchorProps.download === undefined && (target === undefined || target === '_self')
    && store.canHandleLink(href);

  useEffect(() => {
    if (prefetch !== 'viewport'
      || anchorProps.download !== undefined
      || target !== undefined && target !== '_self'
      || anchor.current === null
      || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const element = anchor.current;
    let observer: IntersectionObserver | undefined;
    const updateConnection = () => {
      if (!store.isConnected() || !store.canHandleLink(href)) {
        observer?.disconnect();
        observer = undefined;
        store.cancelPrefetch(href, viewportOwner.current);
        return;
      }
      if (observer !== undefined) return;
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            store.prefetch(href, viewportOwner.current);
          } else {
            store.cancelPrefetch(href, viewportOwner.current);
          }
        }
      });
      observer.observe(element);
    };
    const unsubscribe = store.subscribe(updateConnection);
    updateConnection();
    return () => {
      unsubscribe();
      observer?.disconnect();
      store.cancelPrefetch(href, viewportOwner.current);
    };
  }, [href, prefetch, store, target, anchorProps.download]);

  useEffect(() => () => store.cancelPrefetch(href, hoverOwner.current), [href, store]);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      hasNavigationModifier(event) ||
      !eligible()
    ) {
      return;
    }

    event.preventDefault();
    if (prefetch === undefined) {
      store.router.push(href);
    } else {
      store.navigatePrefetchedLink(href);
    }
  };

  return createElement('a', {
    ...anchorProps,
    href: hrefValue,
    onClick: handleClick,
    onPointerEnter: (event) => {
      onPointerEnter?.(event);
      if (!event.defaultPrevented && prefetch === 'hover' && eligible()) {
        store.prefetch(href, hoverOwner.current);
      }
    },
    onPointerLeave: (event) => {
      onPointerLeave?.(event);
      if (prefetch === 'hover') {
        store.cancelPrefetch(href, hoverOwner.current);
      }
    },
    ref: anchor,
    target,
  }, children);
}
