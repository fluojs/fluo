import { ForbiddenException, type MiddlewareContext, type Next } from '@fluojs/http';
import { MetricsModule, Registry } from '@fluojs/metrics';

class MetricsTokenMiddleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    if (context.request.headers['x-metrics-token'] !== 'secret-token') {
      throw new ForbiddenException('Metrics endpoint requires x-metrics-token.');
    }

    await next();
  }
}

export class HealthEndpointMiddleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    if (context.request.headers['x-health-token'] !== 'secret-token') {
      throw new ForbiddenException('Health endpoints require x-health-token.');
    }

    await next();
  }
}

export const sharedRegistry = new Registry();

export const opsMetricsModule = MetricsModule.forRoot({
  endpointMiddleware: [MetricsTokenMiddleware],
  http: {
    pathLabelMode: 'template',
    unknownPathLabel: 'UNKNOWN',
  },
  registry: sharedRegistry,
});
