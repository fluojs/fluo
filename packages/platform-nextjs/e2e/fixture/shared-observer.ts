export async function observe(event: string, key = 'shared') {
  const endpoint = process.env.FLUO_E2E_ACCESSOR_GATE;
  if (!endpoint) throw new Error('FLUO_E2E_ACCESSOR_GATE is required');
  const url = new URL(endpoint);
  url.searchParams.set('event', event);
  url.searchParams.set('key', key);
  url.searchParams.set('pid', String(process.pid));
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Accessor gate failed: ${response.status}`);
  await response.text();
}
