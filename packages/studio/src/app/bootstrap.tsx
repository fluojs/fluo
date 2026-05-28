import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

/**
 * Provides bootstrap Studio App behavior for the Studio devtool.
 */
export function bootstrapStudioApp(): void {
  const app = document.querySelector<HTMLDivElement>('#app');

  if (!app) {
    throw new Error('App root not found.');
  }

  const root = createRoot(app);
  flushSync(() => {
    root.render(<App />);
  });
}
