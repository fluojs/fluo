import {
  createNextPagesRouterHandler,
  type NextPagesRouterConfig,
} from '@fluojs/platform-nextjs/pages-router';

export default createNextPagesRouterHandler(() =>
  import('../../../backend').then(({ nextAdapter }) => nextAdapter),
);

export const config = {
  api: { bodyParser: false },
} satisfies NextPagesRouterConfig;
