import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

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
