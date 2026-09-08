import { blogToken, getOtherApplication } from '../../../shared-application';

export async function GET() {
  const { app } = await getOtherApplication();
  const blog = await app.container.resolve(blogToken);
  return Response.json({ instance: blog.instance, pid: process.pid });
}
