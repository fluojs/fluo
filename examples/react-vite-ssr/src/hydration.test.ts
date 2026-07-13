// @vitest-environment happy-dom

import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HydratedCounter } from './page';

describe('react-vite-ssr hydration', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('makes server HTML interactive without hydration errors', async () => {
    // Given: HTML produced by the same component used by the client entry.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    container.innerHTML = renderToString(createElement(HydratedCounter));
    document.body.append(container);

    // When: the client hydrates and the user activates the counter.
    const root = hydrateRoot(container, createElement(HydratedCounter));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const button = document.querySelector('button');
    button?.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // Then: React preserves the server HTML and attaches the interaction.
    expect(button?.textContent).toBe('Count: 1');
    expect(consoleError).not.toHaveBeenCalled();
    root.unmount();
  });
});
