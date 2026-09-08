import { readBlog } from '../../../shared-application';

export async function GET(request: Request) {
  const actor = request.headers.get('x-fixture-actor') ?? 'anonymous';
  return Response.json(await readBlog('route', actor));
}
