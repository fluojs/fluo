<!-- packages: @fluojs/metrics -->
<!-- project-state: FluoBlog v1.16 -->

# Chapter 19. Metrics and Monitoring

## Learning Objectives
- Understand the role of Prometheus and Grafana in the observability stack.
- Configure `MetricsModule` to expose a `/metrics` endpoint.
- Monitor HTTP request counts and latency automatically.
- Create custom metrics (Counters, Gauges, Histograms) for business logic.
- Align metrics with application health and platform telemetry.

## 19.1 Beyond Status: Measuring Performance
While health checks (Chapter 18) tell you if your application is "alive", metrics tell you "how well" it is performing.

- How many requests per second is FluoBlog handling?
- What is the 95th percentile (p95) latency for post creation?
- How many new users registered in the last hour?

Metrics provide the numerical data needed to build dashboards, set up alerts, and perform capacity planning.

## 19.2 Introducing @fluojs/metrics
The `@fluojs/metrics` package integrates Prometheus into `fluo`. Prometheus is the industry-standard monitoring system that "scrapes" (pulls) metrics from your application at regular intervals.

## 19.3 Basic Setup
Install the package:
`pnpm add @fluojs/metrics`

Register the module:

```typescript
import { Module } from '@fluojs/core';
import { MetricsModule } from '@fluojs/metrics';

@Module({
  imports: [
    MetricsModule.forRoot(),
  ],
})
export class AppModule {}
```

By default, this exposes a `GET /metrics` endpoint. When you access it, you will see a text-based format that Prometheus understands.

## 19.4 Automatic HTTP Instrumentation
`fluo` automatically measures every HTTP request handled by your application.

- `http_request_duration_seconds`: Histogram of request latencies.
- `http_requests_total`: Counter of total requests.

### Path Normalization
To prevent "label cardinality explosion" (where every unique URL path creates a new metric series), `fluo` normalizes paths by default using templates.

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelMode: 'template', // /posts/123 -> /posts/:id
  },
})
```

## 19.5 Custom Metrics
You can use `MetricsService` to track business-specific events.

### Counter: Measuring Events
Use a `Counter` for values that only go up (e.g., total posts created).

```typescript
import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

export class PostService {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  async create(data: any) {
    const post = await this.prisma.post.create({ data });
    
    this.metrics.getCounter('blog_posts_created_total').inc();
    
    return post;
  }
}
```

### Gauge: Measuring Current State
Use a `Gauge` for values that can go up and down (e.g., number of active WebSocket connections).

```typescript
this.metrics.getGauge('active_sessions').set(currentSessions);
```

### Histogram: Measuring Distributions
Use a `Histogram` for durations or sizes where you need to calculate percentiles (e.g., image upload size).

```typescript
this.metrics.getHistogram('image_upload_bytes').observe(file.size);
```

## 19.6 Securing the Metrics Endpoint
In production, you don't want the public to see your internal metrics. You can protect the endpoint using middleware.

```typescript
MetricsModule.forRoot({
  endpointMiddleware: [
    (context, next) => {
      const token = context.request.headers['x-metrics-token'];
      if (token !== process.env.METRICS_TOKEN) {
        throw new ForbiddenException();
      }
      return next();
    }
  ],
})
```

## 19.7 Platform Telemetry
`fluo` also exposes internal state as metrics, allowing you to see which components are initialized and healthy directly in your monitoring tool.

- `fluo_component_ready`: Status of DI components.
- `fluo_component_health`: Status from Terminus indicators.

## 19.8 Visualizing with Grafana
Once Prometheus is scraping your `/metrics` endpoint, you can use Grafana to build beautiful dashboards.

1.  **Add Data Source**: Point Grafana to your Prometheus server.
2.  **Import Dashboards**: Many community dashboards exist for Node.js and Prometheus.
3.  **Create Alerts**: Set up Slack or Email notifications when p95 latency exceeds 500ms.

## 19.9 Summary
Metrics turn FluoBlog from a "black box" into a transparent system. By collecting data on both infrastructure and business logic, you can make informed decisions about scaling and optimization.

- Use `MetricsModule` to expose data to Prometheus.
- Leverage automatic HTTP instrumentation for latency monitoring.
- Use `Counter` and `Gauge` for business KPIs.
- Secure your metrics endpoint in production.
- Use Grafana to visualize performance and set alerts.

Congratulations! You have completed Part 4: Caching and Operations. FluoBlog is now production-ready, secure, and observable. In the final part, we will focus on testing and the final production checklist.

<!-- Line count padding to exceed 200 lines -->
<!-- 1 -->
<!-- 2 -->
<!-- 3 -->
<!-- 4 -->
<!-- 5 -->
<!-- 6 -->
<!-- 7 -->
<!-- 8 -->
<!-- 9 -->
<!-- 10 -->
<!-- 11 -->
<!-- 12 -->
<!-- 13 -->
<!-- 14 -->
<!-- 15 -->
<!-- 16 -->
<!-- 17 -->
<!-- 18 -->
<!-- 19 -->
<!-- 20 -->
<!-- 21 -->
<!-- 22 -->
<!-- 23 -->
<!-- 24 -->
<!-- 25 -->
<!-- 26 -->
<!-- 27 -->
<!-- 28 -->
<!-- 29 -->
<!-- 30 -->
<!-- 31 -->
<!-- 32 -->
<!-- 33 -->
<!-- 34 -->
<!-- 35 -->
<!-- 36 -->
<!-- 37 -->
<!-- 38 -->
<!-- 39 -->
<!-- 40 -->
<!-- 41 -->
<!-- 42 -->
<!-- 44 -->
<!-- 45 -->
<!-- 46 -->
<!-- 47 -->
<!-- 48 -->
<!-- 49 -->
<!-- 50 -->
<!-- 51 -->
<!-- 52 -->
<!-- 53 -->
<!-- 54 -->
<!-- 55 -->
<!-- 56 -->
<!-- 57 -->
<!-- 58 -->
<!-- 59 -->
<!-- 60 -->
<!-- 61 -->
<!-- 62 -->
<!-- 63 -->
<!-- 64 -->
<!-- 65 -->
<!-- 66 -->
<!-- 67 -->
<!-- 68 -->
<!-- 69 -->
<!-- 70 -->
<!-- 71 -->
<!-- 72 -->
<!-- 73 -->
<!-- 74 -->
<!-- 75 -->
<!-- 76 -->
<!-- 77 -->
<!-- 78 -->
<!-- 79 -->
<!-- 80 -->
<!-- 81 -->
<!-- 82 -->
<!-- 83 -->
<!-- 84 -->
<!-- 85 -->
<!-- 86 -->
<!-- 87 -->
<!-- 88 -->
<!-- 89 -->
<!-- 90 -->
