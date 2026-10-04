import { createNextAppRouterHandler } from '@fluojs/platform-nextjs/app-router';

export const { GET, POST } = createNextAppRouterHandler(() =>
  import('../../backend').then(({ adapter }) => adapter),
);
