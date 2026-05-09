import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX({
  configPath: 'source.config.ts',
});

export default withMDX({});
