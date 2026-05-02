<!-- packages: @fluojs/metrics -->
<!-- project-state: FluoBlog v1.16 -->

# Chapter 19. Metrics and Monitoring

This chapter explains the metrics collection and monitoring flow for observing FluoBlog's runtime state with numbers. If Chapter 18 checked whether the service is alive, this chapter extends that work into a way to continuously read performance and traffic changes.

## Learning Objectives
- Understand the roles of Prometheus and Grafana in an observability stack.
- Configure `MetricsModule` to expose the `/metrics` endpoint.
- Automatically monitor HTTP request counts and latency.
- Create Counter, Gauge, and Histogram metrics for business logic.
- Connect metrics to application state and platform telemetry.
- Use labels and tagging to break data down by dimension.
- Design threshold-based alerting rules.

## Prerequisites
- Completion of Chapter 18.
- Basic understanding of Prometheus-style time-series metrics.
- Basic understanding of operational indicators such as HTTP request latency and error rate.

## 19.1 Beyond Status: Measuring Performance
If health checks from Chapter 18 tell you whether an application is "alive," metrics tell you "how well" it is operating. Monitoring metrics moves you away from only digging through logs after a problem occurs and lets you read performance degradation and traffic changes earlier. Without metrics, you can know that a server is running, but it is hard to tell where load is growing, which latency segment is increasing, or which direction resource usage is moving.

- **Throughput**: How many requests per second (RPS) is FluoBlog handling? Is load distributed evenly across all instances?
- **Latency**: What is the 95th percentile (p95) latency for creating a post? Is it getting slower over time as the database grows?
- **Business KPIs**: How many new users registered in the last hour? How many posts were published today?
- **Error Rates**: What percentage of all requests return 5xx errors? Is one route failing more often than others?

Metrics provide the numerical data needed to build dashboards, configure alerts, and perform capacity planning, for example, "Based on the current growth rate, we need to double our server count before the end-of-year sale." They turn a vague feeling about performance into engineering evidence the team can review.

### 19.1.1 The Golden Signals
Google's SRE handbook defines the "four golden signals" of monitoring as latency, traffic, errors, and saturation. Fluo's metrics system is designed to provide visibility into all four by default. Starting with these signals gives you a clear entry point when analyzing production issues. For example, a latency spike combined with high saturation usually signals that CPU or memory resources need to be scaled.

### 19.1.2 Proactive vs. Reactive Monitoring
Reactive monitoring means fixing problems after they occur, such as receiving an alert because a server crashed. Proactive monitoring means identifying trends before an outage occurs, such as noticing memory usage gradually increasing over several days. Fluo's metrics support this approach and create time for planned fixes instead of overnight incident response.

### 19.1.3 Metrics vs. Logs: Choosing the Right Tool
It is important to understand the difference between **metrics** and **logs**. Logs are high-cardinality data that record specific events, for example, "user 123 logged in at 10:05 a.m." Metrics are low-cardinality data that aggregate those events into numerical values, for example, "there were 50 logins during the last minute."

Logs are useful for debugging "why did this specific request fail?" Metrics are best for answering "is the system as a whole working correctly?" A well-designed Fluo application uses both. When a metrics alert fires, such as a high error rate, you use logs to inspect specific errors and find the root cause. This correlation between metrics and logs is key to fast incident response.

### 19.1.4 The Business Value of Monitoring
Beyond technical health, metrics also give business stakeholders evidence for decisions. Tracking events such as "purchase completed," "search query," and "content viewed" lets you see how features are used in near real time. This data helps product managers make evidence-based decisions about which features to invest in and which to retire. `@fluojs/metrics` helps the backend provide a consistent source of truth for both engineers and business leaders.

### 19.1.5 Metrics and Capacity Planning
One often overlooked but important aspect of monitoring is **capacity planning**. Analyzing long-term metric trends, such as CPU usage over the last six months, helps you predict when the current infrastructure will reach its limits. This approach gives you time to provision new resources or optimize inefficient code *before* users experience degraded performance.

Fluo's metrics system makes it easy to export data to long-term storage solutions such as Thanos or Cortex, enabling years of historical analysis. When you treat metrics as an operational asset, you can manage the scaling direction of the FluoBlog application more predictably as the user base grows from hundreds to millions.

### 19.1.6 The Psychology of Monitoring
Finally, you should also consider the **psychology** of monitoring setup. Dashboards that are too complex or alerting systems that are too noisy eventually cause alert fatigue and reduce developer productivity. A well-designed metrics stack should clearly distinguish normal states from states that require action. Prioritizing clarity and actionability in metrics lets engineering teams make operational decisions in a more stable environment.

## 19.2 Introducing @fluojs/metrics
The `@fluojs/metrics` package integrates Prometheus with `fluo`. Prometheus is an industry-standard monitoring system that "scrapes" metrics from applications at regular intervals. It stores this data as time series, so you can query value changes over a given period and easily calculate rates, averages, and percentiles.

### Why Prometheus?
Prometheus was built for the dynamic nature of cloud-native environments. Applications do not need to "push" data to a central server, which simplifies network configuration and prevents the monitoring system from becoming a bottleneck during traffic spikes. It also has a powerful query language, PromQL, and a large ecosystem of exporters for databases, caches, and operating systems.

## 19.3 Basic Setup
The basic setup is intentionally small. Before you create custom dashboards, it lets you start exposing useful telemetry first. Rather than designing many metrics on day one, start by opening the default endpoint and confirming that real data begins to flow.

Install the package: `pnpm add @fluojs/metrics`

Then register the Module in the root `AppModule`:

```typescript
import { Module } from '@fluojs/core';
import { MetricsModule } from '@fluojs/metrics';

@Module({
  imports: [
    MetricsModule.forRoot({
      // Optional: you can change the default /metrics path.
      path: '/internal/prometheus',
      // Required when you want automatic HTTP request metrics.
      http: true,
    }),
  ],
})
export class AppModule {}
```

By default, this exposes the `GET /metrics` endpoint. When you access this endpoint, you can see text-format data, OpenMetrics, that includes internal Node.js metrics such as CPU, memory, and garbage collection, as well as Fluo-specific metrics. This "OpenMetrics" format is a common format widely used by modern observability tools, and many monitoring tools can read it as-is.

### 19.3.1 Under the Hood: The Registry
`MetricsModule` maintains an internal registry of every metric defined in the application. When the `/metrics` endpoint is called, the Module walks this registry, collects the current values, and converts them into a text response format. This process should stay lightweight so scrape requests do not add unnecessary load to application performance.

### 19.3.2 Scrape Intervals and Resolution
One important consideration is how often Prometheus should scrape the application. Typical intervals are 15 or 30 seconds. Shorter intervals provide higher-resolution data but increase server load. Longer intervals are lighter, but they can miss short traffic micro-bursts. Fluo's metrics are designed to be thread-safe and non-blocking, so operators can choose an interval based on the balance between accuracy and cost.

### 19.3.3 Customizing the Default Registry
Fluo provides a global default registry, but sometimes you may need to manage multiple registries to separate system metrics from business KPIs. `MetricsModule` lets you define and inject custom registries, giving you full control over how data is organized and exposed. This is especially useful in multi-tenant applications where you want to expose a separate metrics endpoint for each tenant.

### 19.3.4 Integration with Cloud-Native Sidecars
In service mesh environments such as Istio or Linkerd, applications often run with sidecar proxies. These proxies may have their own metrics, but they can also be configured to aggregate and expose Fluo application metrics. Because Fluo follows the OpenMetrics standard, this data connects naturally with sidecar-based observability patterns.

### 19.3.5 Metrics in Distributed Environments
In distributed systems where multiple application instances run across different availability zones or cloud providers, `MetricsModule` helps each instance report data in a consistent and identifiable way. Automatically including instance-level labels such as `pod_name` or `host_ip` lets monitoring tools aggregate data across the full server fleet while still drilling into a single problematic instance.

This "aggregate first, drill down second" approach is key to managing complexity at scale. You can check the global error rate for the whole API and, if the error rate spikes, identify whether it is happening across all instances or only on a specific set of nodes in a specific region. This level of visibility is the practical standard a metrics module should meet in modern infrastructure.

### 19.3.6 Extending Prometheus with Custom Exporters
Fluo provides several metrics by default, but you can expand monitoring coverage by integrating with third-party **Prometheus Exporters**. For example, you might use `process-exporter` for deeper visibility into the Node.js event loop, or `blackbox-exporter` to monitor APIs externally. Fluo's metrics system complements these external tools and lets you observe the application stack across multiple layers.

## 19.4 Automatic HTTP Instrumentation
`fluo` can automatically measure every HTTP request handled by the application when HTTP instrumentation is enabled. Pass `http: true` (or an `http` options object) to `MetricsModule.forRoot(...)` when you want baseline API performance visibility in addition to the scrape endpoint.

- `http_request_duration_seconds`: A **Histogram** of request latency broken down by method, path, and status code.
- `http_requests_total`: A **Counter** for total request count, which enables RPS and error rate calculations.

### Path Normalization
To prevent label cardinality explosion, a problem where a new metric series is created for every unique URL path such as `/posts/1` and `/posts/2`, which adds load to the system, `fluo` uses route templates by default to normalize paths. This groups all requests for the same endpoint, making dashboards much more useful and the Prometheus database more efficient.

```typescript
MetricsModule.forRoot({
  http: {
    // The /posts/123 path is recorded as /posts/:id.
    pathLabelMode: 'template', 
  },
})
```

### 19.4.1 Bucket Tuning for Latency
Histograms use buckets to count how many requests fall into different time ranges, for example, <100ms, <500ms, and <1s. Fluo provides reasonable defaults, but for ultra-low-latency APIs, you may want to define custom buckets. For example, if your target response time is under 50ms, you can configure more granular buckets in the 0-100ms range. This precision lets you see exactly where performance degradation occurs.

### 19.4.2 Response Size Tracking
In addition to latency, you often want to see response size, but the current default HTTP metrics contract is limited to `http_requests_total`, `http_errors_total`, and `http_request_duration_seconds`. If you want to track response size distribution, it is better to add it as an application-specific custom metric or through a separate Middleware layer.

## 19.5 Custom Metrics
You can use `MetricsService` to track business-specific events. This service is available anywhere in the application through Dependency Injection. Custom metrics connect general-purpose server monitoring to the application's actual value flow.

### Counter: Measuring Events
Use `Counter` for values that only increase, such as total posts created, emails sent, or payments processed. Counters become the basic building block for rate calculations in PromQL.

```typescript
import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

@Inject(MetricsService)
export class PostService {
  constructor(private readonly metrics: MetricsService) {}

  async create(data: any) {
    const post = await this.prisma.post.create({ data });
     
     // Increment the counter each time a new post is created.
    this.metrics.counter({
      name: 'blog_posts_created_total',
      help: 'Number of blog posts created',
    }).inc();
    
    return post;
  }
}
```

### Gauge: Measuring Current State
Use `Gauge` for values that can go up or down, such as active WebSocket connections, items waiting in a queue, or currently logged-in users. A gauge represents a snapshot at a specific point in time.

```typescript
// Set the current value directly.
this.metrics.gauge({
  name: 'active_sessions_count',
  help: 'Current number of active sessions',
}).set(currentSessions);
```

### Histogram: Measuring Distributions
Use `Histogram` for durations or sizes where you need to calculate percentiles, such as background job processing time, uploaded image size, or number of search result items.

```typescript
// Observe the uploaded file size.
this.metrics.histogram({
  name: 'image_upload_size_bytes',
  help: 'Uploaded image size',
}).observe(file.size);
```

### 19.5.1 Labels: Adding Dimension to Data
Labels are key-value pairs you can add to metrics to provide more context. For example, instead of tracking only `posts_created_total`, you can add a `category` label. This lets you query how many "technology" posts were created compared with "lifestyle" posts. Labels are very powerful, but they must be used carefully. Every unique combination of label values creates a new time-series data set, which can consume significant Prometheus memory.

### 19.5.2 Summary: Client-Side Aggregation
Fluo primarily focuses on histograms for distribution measurement, but it also supports `Summary` metrics. A summary calculates percentiles, such as p95, directly on the application server. This is useful when the sample count is very high and you want to reduce Prometheus load, but it has the drawback that these percentiles cannot be accurately aggregated across multiple server instances. For most Fluo applications, histograms are the recommended choice.

### 19.5.3 Best Practices for Naming Metrics
Naming conventions are very important for long-term maintainability. Follow the Prometheus convention `namespace_subsystem_name_unit_suffix`.
- `namespace`: Application name, for example, `fluoblog`.
- `subsystem`: Module or service, for example, `posts`.
- `name`: What is being measured, for example, `created`.
- `unit`: Measurement unit, for example, `total` for counters or `seconds` for durations.

Example: `fluoblog_posts_created_total`. A consistent naming convention makes it much easier to find and query metrics in Grafana even after an application grows to hundreds of different metrics.

### 19.5.4 Advanced Label Management: Dynamic Labels
Sometimes label values are not known until runtime. Fluo's metrics service lets you pass labels dynamically when recording a value. For example, you can track the `error_code` for failed payments: `metrics.counter({ name: 'payment_failures_total', help: 'Number of failed payments', labelNames: ['code'] }).inc({ code: error.code })`.

Be very careful with **cardinality** here. If the `code` label can have thousands of unique values, such as stack traces, it will overload Prometheus. Always make sure label values stay within a bounded range. If you need to track high-cardinality data, use logs instead of metrics.

### 19.5.5 Metric Initialization and "Zeroing"
A common monitoring problem is that metrics do not appear in Prometheus until they are recorded for the first time. This can make dashboards look "empty" or break rate calculations. To solve this, it is a good idea to pre-register the required counters, gauges, and histograms during application startup.

## 19.6 Securing the Metrics Endpoint
In production, you likely do not want to expose internal metrics to the general public. Metrics can reveal sensitive information about traffic patterns, user growth, and internal architecture. You can protect the endpoint with custom Middleware or Fluo's built-in security features.

```typescript
MetricsModule.forRoot({
  endpointMiddleware: [
    (context, next) => {
      const apiKey = context.request.headers['x-monitoring-key'];
      if (apiKey !== process.env.MONITORING_SECRET) {
        throw new ForbiddenException('Restricted Access');
      }
      return next();
    }
  ],
})
```

### 19.6.1 IP Whitelisting
A common production pattern is allowing only the Prometheus server IP address to access the `/metrics` route. This provides a strong security layer without requiring complex authentication logic in the monitoring tool. Most cloud providers let you implement this at the network level through security groups or firewalls, but Fluo's Middleware system also gives you a flexible way to handle it in code.

### 19.6.2 Metrics and Compliance
In tightly regulated industries such as finance or healthcare, be careful not to include personally identifiable information (PII) in metric labels. Never use user IDs, email addresses, IP addresses, or similar values as labels. Use only high-level categories and system attributes so your monitoring stack complies with data privacy regulations such as GDPR or HIPAA.

### 19.6.3 Audit Logging for Metrics Access
In highly secure environments, you may want to log every access to the `/metrics` endpoint. This provides an audit trail that helps identify unauthorized scrape attempts or internal misuse. Fluo's Middleware system lets you add this audit logging logic, so the monitoring stack can be managed at the same level as the application's other internal routes.

Combining IP whitelisting, API keys, and audit logging lets you build a defense-in-depth strategy for metrics. It limits operational data exposure to approved systems and people, and it helps manage the confidentiality and integrity of the application's vital signs.

### 19.6.4 Managing Metric Scraping Load
If the metric count is very high or the scrape frequency is very high, generating the metrics response can become a performance bottleneck by itself. The current `@fluojs/metrics` module does not expose a built-in response-cache option, so add short-lived caching at a reverse proxy, platform middleware, or dedicated application middleware boundary when you need it.

This is especially useful during traffic spikes when the server is already under load. Keeping that cache outside `MetricsModule` makes ownership explicit while still reducing server CPU usage without significantly affecting monitoring data freshness. Keeping the monitoring system lightweight ensures that collecting observability data does not add more application load during important performance events.

## 19.7 Platform Telemetry
`fluo` also exposes its internal state as metrics. This lets monitoring tools directly check which components have initialized and are healthy. This "self-monitoring" feature is a useful starting point when debugging problems related to application structure.

- `fluo_component_ready`: Tracks whether DI components have finished initialization. If a specific instance is stuck, this metric can tell you which Provider is the bottleneck.
- `fluo_component_health`: Integrates the state of the Terminus indicators covered in Chapter 18 into the metrics stream. This lets you analyze performance degradation in relation to health state changes.
- `fluo_metrics_registry_mode`: Exposes which mode the current metrics registry is operating in.

### 19.7.1 Built-in Platform Telemetry Boundaries
You may want to see more detailed operational numbers beyond a simple "healthy/unhealthy" state, but the current built-in platform telemetry exposure focuses on framework-level signals such as readiness, health, and registry mode. For more granular dependency internals, such as database pool size, active connection count, and queued request count, it is more accurate to treat them as custom metrics exposed separately by the relevant library or application, rather than assuming they are part of this chapter's basic built-in metrics contract.

Understanding this boundary also makes dashboards easier to interpret. The default metrics show whether the framework is ready, whether it is healthy, and how many requests are coming in, while deeper infrastructure analysis is left to instrumentation you add separately on top.

### 19.7.2 Tracking Framework Overhead
You may want a more detailed view of framework overhead, but the current default HTTP metrics focus on request counts, error counts, and request latency. Do not assume that per-stage timings for Middleware, Guard, Interceptor, and Pipe execution are included as default built-in metrics. If you need that analysis, add application-specific instrumentation or a separate profiling strategy.

## 19.8 Visualizing with Grafana
Once Prometheus starts scraping the `/metrics` endpoint, you can use Grafana to build real-time dashboards that show the whole system state at a glance.

1. **Add a data source**: Point Grafana at the Prometheus server.
2. **Build dashboards**: Use PromQL, Prometheus Query Language, to visualize data.
   - Example: `rate(http_requests_total[5m])` shows the five-minute average number of requests per second.
   - Example: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` calculates 95th percentile latency.
3. **Configure alerts**: Configure Grafana to send Slack or email notifications if the error rate exceeds 1% or p95 latency stays above 1 second for more than 5 minutes.

### 19.8.1 Dashboard Best Practices
A good dashboard should be hierarchical. Start with top-level state, healthy or unhealthy and overall error rate, then show key performance indicators such as RPS and latency, and finally provide deep-dive panels for specific modules or services. Clear titles, consistent colors, and useful descriptions help team engineers quickly understand system state during incidents.

### 19.8.2 Alerting for "Fatigue"
Be careful not to make alerts too sensitive. If an alert fires every time traffic jumps for one second, team members will soon start ignoring alerts. This is called alert fatigue. Use averages and durations, for example, "error rate above 5% for 3 minutes," to filter out temporary noise and tune alerts so the notifications your team receives point to situations that truly need action.

### 19.8.3 Sharing Dashboards: Monitoring as Code
In modern engineering teams, dashboards are often treated as code. You can export Grafana dashboards as JSON files and store them in version control, Git, alongside Fluo code. This gives every developer on the team access to the same visualization tools, and changes to monitoring logic can be reviewed and audited just like application code.

Fluo provides a set of **reference dashboard templates** for common use cases, such as "API overview" and "database performance." You can import these templates into a Grafana instance and customize them for your specific needs, giving your observability stack a consistent baseline.

### 19.8.4 Continuous Improvement via Metrics
The long-term goal of monitoring is **continuous improvement**. Use metrics to set team performance goals, for example, "reduce p99 latency by 20% by next quarter." Making performance visible and measurable grounds optimization discussions in data rather than guesses.

Review dashboards and alerts regularly to identify new patterns or emerging bottlenecks. As the application evolves, your monitoring strategy should continue to evolve with it. In the Fluo ecosystem, metrics are not just a debugging tool, but a practical foundation for consistently operating faster and more reliable software.

## 19.9 Summary
Metrics turn FluoBlog from a "black box" into an observable system. Collecting data from both infrastructure and business logic lets you make informed decisions about scaling and optimization, identify performance bottlenecks earlier, and explain service reliability with objective numbers.

- **Observability**: Prometheus provides the "what" and "when" of system behavior through time-series data.
- **Custom tracking**: Use `Counter`, `Gauge`, and `Histogram` to measure business-critical KPIs and system state.
- **HTTP instrumentation**: Fluo provides baseline HTTP request, error, and latency metrics when `MetricsModule.forRoot({ http: true })` or equivalent HTTP options are enabled.
- **Alerting**: Use Grafana to prepare proactive incident response by notifying the team when performance degrades or error rates spike.
- **Standardization**: By following the OpenMetrics standard, Fluo remains compatible with the modern monitoring ecosystem.

Part 4, caching and operations, is complete. FluoBlog now has faster read paths, clear health signals, and metrics for observing runtime state. In the final part, we will focus on testing and final production checks.

### 19.9.1 The Future of Observability in Fluo
As backend engineering moves toward increasingly complex distributed systems, the scope of observability expands as well. Future framework versions will include deeper integration with **distributed tracing, OpenTelemetry** and **log aggregation**, providing a "single pane of glass" for interpreting operational data in one place.

The work in this chapter is the starting point for operational observability. If you prioritize metrics and monitoring from the beginning of a project, you can build a backend foundation that is not only fast and safe, but also explainable and manageable. Keep exploring the Prometheus and Grafana ecosystems, and use the data they provide to continuously improve your Fluo applications.
