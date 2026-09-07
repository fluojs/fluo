import { createNextAppRouterHandler } from '@fluojs/platform-nextjs/app-router';

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createNextAppRouterHandler(() =>
  import('../../../../backend').then(({ nextAdapter }) => nextAdapter),
);
