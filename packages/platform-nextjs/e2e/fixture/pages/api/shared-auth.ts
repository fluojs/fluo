import type { NextApiRequest, NextApiResponse } from 'next';

import { readBlog } from '../../shared-application';

// Test callback input, not an authentication implementation.
export default async function authCallback(request: NextApiRequest, response: NextApiResponse) {
  const actor = request.headers['x-fixture-actor'];
  response.json(await readBlog('auth', typeof actor === 'string' ? actor : 'anonymous'));
}
