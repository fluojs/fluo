import { headers } from 'next/headers';

import { readBlog } from '../../shared-application';

export const dynamic = 'force-dynamic';

export default async function SharedPage() {
  const actor = (await headers()).get('x-fixture-actor') ?? 'anonymous';
  const blog = await readBlog('rsc', actor);
  return <main data-instance={blog.instance} data-pid={blog.pid}
    data-evaluation={blog.evaluation} data-actor={blog.actor}>Shared application</main>;
}
