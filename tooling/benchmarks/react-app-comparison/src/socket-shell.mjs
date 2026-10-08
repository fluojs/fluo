import { request as requestHttp } from 'node:http';
import { performance } from 'node:perf_hooks';

export function readSocketShell(url) {
  return new Promise((resolveSample, rejectSample) => {
    const started = performance.now();
    const request = requestHttp(url, {
      headers: { 'accept-encoding': 'identity' },
      signal: AbortSignal.timeout(10_000),
    }, (response) => {
      const statusCode = response.statusCode;
      const headersAtMs = performance.now() - started;
      let firstByteMs;
      let shellMarkerMs;
      let bytes = 0;
      let html = '';
      response.on('data', (chunk) => {
        firstByteMs ??= performance.now() - started;
        bytes += chunk.byteLength;
        if (shellMarkerMs === undefined) {
          html += chunk.toString('utf8');
          if (html.includes('Product catalog')) shellMarkerMs = performance.now() - started;
        }
      });
      response.once('error', rejectSample);
      response.once('end', () => {
        if (statusCode !== 200 || firstByteMs === undefined || shellMarkerMs === undefined) {
          rejectSample(new Error(`Missing complete socket shell: HTTP ${statusCode}, first=${firstByteMs}, marker=${shellMarkerMs}`));
          return;
        }
        resolveSample({
          statusCode, headersAtMs, firstByteMs, shellMarkerMs, bytes,
          contentEncoding: response.headers['content-encoding'] ?? 'identity',
        });
      });
    });
    request.once('error', rejectSample);
    request.end();
  });
}
