import { createNextAppRouterHandler } from '@fluojs/platform-nextjs/app-router';

// No HEAD export: Next itself calls GET while preserving request.method === HEAD.
export const { GET } = createNextAppRouterHandler(() =>
  import('../../../../backend').then(({ nextAdapter }) => nextAdapter),
);
