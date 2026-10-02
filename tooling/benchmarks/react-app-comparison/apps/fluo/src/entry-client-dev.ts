import '@vitejs/plugin-react/preamble';

import.meta.hot?.on('fluo:server-status', (message: { status: string; generation: number }) => {
  window.dispatchEvent(new CustomEvent('fluo:server-status', { detail: message }));
});

await import('./entry-client');
