import { createElement, type AnchorHTMLAttributes, type MouseEvent, type ReactElement } from 'react';

import { useClientNavigationStore } from './provider.js';

/** Props accepted by the progressive-enhancement-friendly client navigation anchor. */
export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  readonly href: string | URL;
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
export function Link({ children, href, onClick, target, ...anchorProps }: LinkProps): ReactElement {
  const store = useClientNavigationStore();
  const hrefValue = String(href);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      hasNavigationModifier(event) ||
      anchorProps.download !== undefined ||
      (target !== undefined && target !== '_self') ||
      !store.canHandleLink(href)
    ) {
      return;
    }

    event.preventDefault();
    store.router.push(href);
  };

  return createElement('a', { ...anchorProps, href: hrefValue, onClick: handleClick, target }, children);
}
