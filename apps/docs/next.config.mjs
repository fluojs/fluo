import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX({
  configPath: 'source.config.ts',
});

export default withMDX({
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  async redirects() {
    return [
      { source: '/:locale(en|ko)/docs/:path*', destination: '/docs/:path*', permanent: true },
      { source: '/:locale(en|ko)', destination: '/docs', permanent: true },
    ];
  },
});
