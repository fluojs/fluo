import { createNextAppRouterHandler } from '@fluojs/platform-nextjs/app-router';

import { getApplication } from '../../../shared-application';

export const { GET } = createNextAppRouterHandler(() =>
  getApplication().then(({ adapter }) => adapter),
);

export async function POST() {
  const { app } = await getApplication();
  await app.close();
  return Response.json({ state: app.state });
}
