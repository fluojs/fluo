import { getFailedApplication } from '../../../shared-application';

export async function GET() {
  try {
    await getFailedApplication();
    return Response.json({ unexpected: true });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}
