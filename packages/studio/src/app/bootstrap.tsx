import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App.js';

/**
 * Provides bootstrap Studio App behavior for the Studio devtool.
 *
 * @returns The mounted React root so tests and embedding callers can unmount the viewer cleanly.
 */
export function bootstrapStudioApp(): Root {
  const app = document.querySelector<HTMLDivElement>('#app');

  if (!app) {
    throw new Error('App root not found.');
  }

  const root = createRoot(app);
  flushSync(() => {
    root.render(<App />);
  });

  return root;
}
