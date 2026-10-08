import { fluoDecoratorsPlugin } from '@fluojs/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, normalizePath, type Plugin } from 'vite';

const plugins: Plugin[] = [
    {
      name: 'fluo:shared-reload-after-readiness',
      apply: 'serve',
      enforce: 'pre',
      hotUpdate({ file }) {
        const serverFiles: unknown = Reflect.get(process, Symbol.for('fluo:react-server-files'));
        if (this.environment.name === 'client' && serverFiles instanceof Set && serverFiles.has(file)) return [];
      },
    },
    fluoDecoratorsPlugin(),
    ...react(),
    {
      name: 'fluo:react-development-graph',
      apply: 'serve',
      enforce: 'post',
      transform(_code, id) {
        if (this.environment?.name === 'client' && /\.(?:tsx?|jsx?|css)(?:\?|$)/u.test(id)
          && id.startsWith(normalizePath(resolve('src')) + '/')) {
          const file = id.split('?')[0];
          if (file && process.send) process.send({ type: 'fluo:react-vite-hmr-file', file });
        }
      },
    },
];

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    emptyOutDir: false,
    outDir: 'dist/server',
    rollupOptions: { output: { entryFileNames: 'main.js' } },
    ssr: 'src/main.ts',
    target: 'node24',
  },
  plugins,
});
