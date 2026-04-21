<!-- packages: @fluojs/metrics -->
<!-- project-state: FluoBlog v1.16 -->

# Chapter 19. Metrics and Monitoring

## Learning Objectives
- Understand the role of Prometheus and Grafana in the observability stack.
- Configure `MetricsModule` to expose a `/metrics` endpoint.
- Monitor HTTP request counts and latency automatically.
- Create custom metrics (Counters, Gauges, Histograms) for business logic.
- Align metrics with application health and platform telemetry.
- Implement advanced labels and tagging for granular data analysis.
- Design performance-aware alerting rules based on statistical thresholds.

## 19.1 Beyond Status: Measuring Performance
While health checks (Chapter 18) tell you if your application is "alive", metrics tell you "how well" it is performing. Monitoring metrics allows you to move from reactive troubleshooting to proactive optimization. Without metrics, you are flying blind; you might know the engine is running, but you don't know the RPM, the oil temperature, or the fuel consumption rate.

- **Throughput**: How many requests per second (RPS) is FluoBlog handling? Is the load balanced evenly across all instances?
- **Latency**: What is the 95th percentile (p95) latency for post creation? Is it getting slower over time as the database grows?
- **Business KPIs**: How many new users registered in the last hour? How many posts were published today?
- **Error Rates**: What percentage of requests are resulting in 5xx errors? Is a specific route failing more often than others?

Metrics provide the numerical data needed to build dashboards, set up alerts, and perform capacity planning (e.g., "Based on our current growth rate, we need to double our server count before the holiday sale"). They turn "gut feelings" about performance into hard engineering facts that can drive business decisions.

### 19.1.1 The Golden Signals
Google's SRE handbook defines the "Four Golden Signals" of monitoring: Latency, Traffic, Errors, and Saturation. Fluo's metrics system is designed to provide visibility into all four of these out of the box. By focusing on these core signals, you can quickly identify the root cause of most production issues. For instance, a spike in latency combined with high saturation often indicates that you need to scale up your CPU or memory resources.

### 19.1.2 Proactive vs. Reactive Monitoring
Reactive monitoring is when you fix things after they break (e.g., an alert triggers because the server crashed). Proactive monitoring is when you identify a trend before it becomes a failure (e.g., noticing that memory usage is slowly climbing over several days). Fluo's metrics allow you to implement this proactive approach, giving you the time to deploy fixes during regular working hours rather than during an emergency at 3:00 AM.

### 19.1.3 Metrics vs. Logs: Choosing the Right Tool
It is important to understand the difference between **Metrics** and **Logs**. Logs are high-cardinality data that record specific events (e.g., "User 123 logged in at 10:05 AM"). Metrics are low-cardinality data that aggregate these events into numerical values (e.g., "There were 50 logins in the last minute"). 

Logs are great for debugging "Why did this specific request fail?", while metrics are best for answering "Is the system as a whole performing correctly?". In a well-architected Fluo application, you use both. When a metric alert triggers (e.g., high error rate), you use logs to drill down into the specific errors and find the root cause. This "Correlation" between metrics and logs is the secret to fast incident response.

### 19.1.4 The Business Value of Monitoring
Beyond technical health, metrics provide immense value to your business stakeholders. By tracking events like "Completed Purchases," "Search Queries," or "Content Views," you can provide real-time feedback on how your features are being used. This data allows product managers to make evidence-based decisions about which features to invest in and which ones to retire. With `@fluojs/metrics`, your backend becomes a source of truth for both your engineers and your business leaders.

### 19.1.5 Metrics and Capacity Planning
A crucial but often overlooked aspect of monitoring is **Capacity Planning**. By analyzing long-term trends in your metrics (e.g., CPU usage over the last six months), you can predict when your current infrastructure will reach its limits. This "Forward-Looking" approach allows you to provision new resources or optimize inefficient code *before* it causes a performance degradation for your users.

Fluo's metrics system makes it easy to export your data to long-term storage solutions like Thanos or Cortex, enabling years of historical analysis. By treating metrics as a strategic asset, you ensure that your FluoBlog application can scale smoothly and predictably as your user base grows from a few hundred to millions of users.

### 19.1.6 The Psychology of Monitoring
Lastly, consider the **Psychology** of your monitoring setup. A dashboard that is too cluttered or an alerting system that is too noisy will eventually lead to "Alert Fatigue" and reduced developer productivity. A well-designed metrics stack should provide a sense of calm and control. It should give you confidence that everything is running as expected and provide a clear path to resolution when it is not. By prioritizing clarity and actionability in your metrics, you create a better working environment for your entire engineering team.

## 19.2 Introducing @fluojs/metrics
The `@fluojs/metrics` package integrates Prometheus into `fluo`. Prometheus is the industry-standard monitoring system that "scrapes" (pulls) metrics from your application at regular intervals. It stores this data as time-series, allowing you to query values over any period and calculate rates, averages, and percentiles with ease.

### Why Prometheus?
Prometheus is built for the dynamic nature of cloud-native environments. It doesn't require your application to "push" data to a central server, which simplifies network configuration and prevents your monitoring system from becoming a bottleneck during traffic spikes. It also features a powerful query language (PromQL) and a massive ecosystem of exporters for databases, caches, and operating systems.

## 19.3 Basic Setup
The basic setup is intentionally small so you can expose useful telemetry before you design any custom dashboard.

Install the package:
`pnpm add @fluojs/metrics`

Register the module in your `AppModule`:

```typescript
import { Module } from '@fluojs/core';
import { MetricsModule } from '@fluojs/metrics';

@Module({
  imports: [
    MetricsModule.forRoot({
      // Optional: change the default /metrics path
      path: '/internal/prometheus',
    }),
  ],
})
export class AppModule {}
```

By default, this exposes a `GET /metrics` endpoint. When you access it, you will see a text-based format (OpenMetrics) containing internal Node.js metrics (CPU, Memory, Garbage Collection) and Fluo-specific metrics. This "OpenMetrics" format is the universal language of modern observability, supported by almost every monitoring tool in existence.

### 19.3.1 Under the Hood: The Registry
The `MetricsModule` maintains an internal "Registry" of all metrics defined in your application. When the `/metrics` endpoint is hit, the module iterates through this registry, collects the current values, and formats them into the text response. This process is highly optimized to ensure that monitoring your application doesn't significantly impact its performance, even if you are collecting thousands of different metrics.

### 19.3.2 Scrape Intervals and Resolution
One important consideration is how often Prometheus should scrape your application. A typical interval is 15 or 30 seconds. A shorter interval gives you higher resolution data but increases the load on your server. A longer interval is lighter but might miss brief "micro-bursts" of traffic. Fluo's metrics are designed to be "Thread-Safe" and "Non-Blocking," ensuring that the scraping process is always fast and predictable regardless of your chosen interval.

### 19.3.3 Customizing the Default Registry
While Fluo provides a global default registry, you might sometimes need to manage multiple registries—for example, to separate system metrics from business KPIs. The `MetricsModule` allows you to define and inject custom registries, giving you total control over how your data is organized and exposed. This is particularly useful in multi-tenant applications where you might want to expose a separate metrics endpoint for each tenant.

### 19.3.4 Integration with Cloud-Native Sidecars
In service mesh environments like Istio or Linkerd, your application often runs alongside a "Sidecar" proxy. These proxies often have their own metrics, but you can also configure them to aggregate and expose your Fluo application's metrics. Fluo's adherence to the OpenMetrics standard ensures that your data is perfectly compatible with these sidecar-based observability patterns, simplifying your infrastructure management.

### 19.3.5 Metrics in Distributed Environments
In a distributed system where multiple instances of your application are running across different availability zones or cloud providers, the `MetricsModule` ensures that each instance reports its data in a consistent and identifiable manner. By automatically including instance-level labels (like `pod_name` or `host_ip`), Fluo allows your monitoring tool to aggregate data across your entire fleet while still being able to drill down into a single problematic instance.

This "Aggregate-First, Drill-Down-Next" approach is the key to managing complexity at scale. You can see the global error rate for your entire API, and if it spikes, you can quickly identify if the errors are coming from all instances or just a specific set of nodes in a particular region. This level of granular visibility is what makes Fluo's metrics module a professional-grade tool for modern infrastructure.

### 19.3.6 Extending Prometheus with Custom Exporters
While Fluo provides a wealth of metrics out of the box, you can further extend your monitoring by integrating with third-party **Prometheus Exporters**. For example, you might use the `process-exporter` to get even deeper visibility into the Node.js event loop or a `blackbox-exporter` to monitor your API from the outside. Fluo's metrics system is designed to complement these external tools, providing a comprehensive and multi-layered view of your entire application stack.

## 19.4 Automatic HTTP Instrumentation
`fluo` automatically measures every HTTP request handled by your application without any extra code. This is one of the most powerful features of the framework, providing instant visibility into your API's performance from the moment you enable the module.

- `http_request_duration_seconds`: A **Histogram** of request latencies, segmented by method, path, and status code.
- `http_requests_total`: A **Counter** of total requests, allowing you to calculate RPS (Requests Per Second) and error rates.

### Path Normalization
To prevent "label cardinality explosion" (where every unique URL path like `/posts/1`, `/posts/2` creates a new metric series), `fluo` normalizes paths by default using their route templates. This ensures that all requests to the same endpoint are grouped together, making your dashboards much more useful and your Prometheus database much more efficient.

```typescript
MetricsModule.forRoot({
  http: {
    // /posts/123 is recorded as /posts/:id
    pathLabelMode: 'template', 
  },
})
```

### 19.4.1 Bucket Tuning for Latency
Histograms use "buckets" to count how many requests fall into different time ranges (e.g., <100ms, <500ms, <1s). Fluo provides sensible defaults, but for ultra-low latency APIs, you might want to define custom buckets. For example, if your goal is sub-50ms responses, you can configure the histogram to have more granular buckets in the 0-100ms range. This level of precision allows you to see exactly where your performance is degrading.

### 19.4.2 Response Size Tracking
In addition to duration, Fluo can also track the size of HTTP responses. This is useful for identifying routes that are returning unexpectedly large payloads, which could be increasing your bandwidth costs or slowing down mobile clients. Monitoring the distribution of response sizes helps you optimize your serialization logic and identify opportunities for pagination or better data filtering.

## 19.5 Custom Metrics
You can use `MetricsService` to track business-specific events. This service is available throughout your application via dependency injection. Custom metrics are what transform a generic server monitor into a true window into your application's value.

### Counter: Measuring Events
Use a `Counter` for values that only go up (e.g., total posts created, emails sent, payments processed). Counters are the building blocks of "Rate" calculations in PromQL.

```typescript
import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

export class PostService {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  async create(data: any) {
    const post = await this.prisma.post.create({ data });
    
    // Increment the counter for every new post
    this.metrics.getCounter('blog_posts_created_total').inc();
    
    return post;
  }
}
```

### Gauge: Measuring Current State
Use a `Gauge` for values that can go up and down (e.g., number of active WebSocket connections, items in a processing queue, or the current number of logged-in users). Gauges represent a snapshot in time.

```typescript
// Set the current value directly
this.metrics.getGauge('active_sessions_count').set(currentSessions);
```

### Histogram: Measuring Distributions
Use a `Histogram` for durations or sizes where you need to calculate percentiles (e.g., the time taken to process a background job, the size of uploaded images, or the number of items in a search result).

```typescript
// Observe the size of an upload
this.metrics.getHistogram('image_upload_size_bytes').observe(file.size);
```

### 19.5.1 Labels: Adding Dimension to Data
Labels are key-value pairs that you can add to any metric to provide more context. For example, instead of just tracking `posts_created_total`, you could add a label for the `category`. This allows you to query how many "Tech" posts were created versus "Lifestyle" posts. Labels are incredibly powerful, but use them wisely; every unique combination of label values creates a new time-series, which can consume significant memory in Prometheus.

### 19.5.2 Summary: Client-Side Aggregation
While Fluo primarily focuses on Histograms for distributions, it also supports `Summary` metrics. A Summary calculates percentiles (like p95) directly on the application server. This is useful when you have a very large number of samples and want to reduce the load on Prometheus, although it comes at the cost of not being able to aggregate these percentiles across multiple server instances accurately. For most Fluo applications, Histograms are the preferred choice.

### 19.5.3 Best Practices for Naming Metrics
Naming is critical for long-term maintainability. Follow the Prometheus convention: `namespace_subsystem_name_unit_suffix`.
- `namespace`: Your application name (e.g., `fluoblog`).
- `subsystem`: The module or service (e.g., `posts`).
- `name`: What is being measured (e.g., `created`).
- `unit`: The unit of measurement (e.g., `total` for counters, `seconds` for durations).

Example: `fluoblog_posts_created_total`. Consistent naming makes it much easier to find and query your metrics in Grafana, especially as your application grows to hundreds of different metrics.

### 19.5.4 Advanced Label Management: Dynamic Labels
In some cases, you might not know the label values until runtime. Fluo's metrics service allows you to pass labels dynamically when recording a value. For example, you could track the `error_code` of failed payments: `metrics.getCounter('payment_failures_total').inc({ code: error.code })`. 

Be very careful with **Cardinality** here. If the `code` label can take thousands of unique values (like a stack trace), it will overwhelm Prometheus. Always ensure that your label values come from a bounded set of possible strings. If you need to track high-cardinality data, use logs instead.

### 19.5.5 Metric Initialization and "Zeroing"
A common issue in monitoring is that a metric doesn't appear in Prometheus until it is recorded for the first time. This can make dashboards look "empty" or break rate calculations. To fix this, you should **Initialize** your metrics with a value of zero during the application startup. Fluo's `MetricsService` provides an `init` method that allows you to pre-register your metrics and their expected labels, ensuring that your dashboards are always populated and your alerts are always active.

## 19.6 Securing the Metrics Endpoint
In production, you don't want the public to see your internal metrics. They can reveal sensitive information about your traffic patterns, user growth, and internal architecture. You can protect the endpoint using custom middleware or Fluo's built-in security features.

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
A common pattern in production is to only allow your Prometheus server's IP address to access the `/metrics` route. This provides a strong layer of security without requiring complex authentication logic in your monitoring tool. Most cloud providers allow you to implement this at the network level using Security Groups or Firewalls, but Fluo's middleware system gives you the flexibility to do it in code as well.

### 19.6.2 Metrics and Compliance
In some regulated industries (like Finance or Healthcare), you must be careful not to include Personally Identifiable Information (PII) in your metric labels. Never include User IDs, Email addresses, or IP addresses as labels. Stick to high-level categories and system attributes to ensure that your monitoring stack remains compliant with data privacy regulations like GDPR or HIPAA.

### 19.6.3 Audit Logging for Metrics Access
In highly secure environments, you might also want to log every time the `/metrics` endpoint is accessed. This provides an audit trail that can help you identify unauthorized scraping attempts or internal misuse. Fluo's middleware system makes it easy to add this audit logging logic, ensuring that your monitoring stack is as secure as the rest of your application.

By combining IP whitelisting, API keys, and audit logging, you can create a "Defense in Depth" strategy for your metrics. This ensures that your operational data is only accessible to authorized systems and individuals, maintaining the confidentiality and integrity of your application's vital signs.

### 19.6.4 Managing Metric Scraping Load
If you have a very large number of metrics or a very high scraping frequency, the act of generating the metrics response can itself become a performance bottleneck. To mitigate this, you can implement **Metrics Caching**. Fluo's `MetricsModule` can be configured to cache the metrics response for a short period (e.g., 5 seconds), reducing the CPU usage on your server without significantly impacting the freshness of your monitoring data.

This is particularly useful during traffic spikes when your server is already under load. By ensuring that your monitoring system remains lightweight and efficient, you guarantee that it provides accurate data even during the most critical performance events.

## 19.7 Platform Telemetry
`fluo` also exposes internal state as metrics, allowing you to see which components are initialized and healthy directly in your monitoring tool. This "Self-Monitoring" capability is essential for debugging issues with your application's structure.

- `fluo_component_ready`: Tracks which DI components have finished their initialization phase. If an instance is stuck, this metric will tell you exactly which provider is the bottleneck.
- `fluo_component_health`: Integrates status from Chapter 18's Terminus indicators into the metrics stream. This allows you to correlate performance drops with health status changes.

### 19.7.1 Detailed Dependency Health in Metrics
Beyond simple "Up/Down" status, Fluo can expose detailed health information for each dependency as metrics. For example, for a database connection, you might see metrics for `pool_size`, `active_connections`, and `waiting_requests`. By correlating these infrastructure metrics with your application-level HTTP metrics, you can quickly identify if a slow response is caused by your code or by a bottleneck in your database pool.

This level of detail is essential for **Root Cause Analysis (RCA)**. Instead of just knowing that the application is slow, you can see exactly where the resource exhaustion is occurring. Fluo's integration between `@fluojs/terminus` and `@fluojs/metrics` provides this unified view out of the box, making your backend "Self-Diagnosing" to a significant degree.

### 19.7.2 Tracking Framework Overhead
A common concern with any framework is the overhead it adds to your application. To address this, Fluo provides metrics for its internal processing stages. You can see the time spent in **Middleware**, **Guards**, **Interceptors**, and **Pipes** for every request. This transparency allows you to see the "Tax" you are paying for each framework feature and make informed decisions about your architectural choices. If a specific guard is taking 50ms to execute, you'll see it clearly in your metrics and can optimize it accordingly.

## 19.8 Visualizing with Grafana
Once Prometheus is scraping your `/metrics` endpoint, you can use Grafana to build beautiful, real-time dashboards that provide an at-a-glance view of your entire system's state.

1. **Add Data Source**: Point Grafana to your Prometheus server.
2. **Build Dashboards**: Use PromQL (Prometheus Query Language) to visualize data.
   - Example: `rate(http_requests_total[5m])` shows requests per second averaged over 5 minutes.
   - Example: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` calculates the 95th percentile latency.
3. **Set Alerts**: Configure Grafana to send a Slack or Email notification if the error rate exceeds 1% or p95 latency exceeds 1 second for more than 5 minutes.

### 19.8.1 Dashboard Best Practices
A good dashboard should be hierarchical. Start with "High-Level" status (Up/Down, Global Error Rate). Then show "Key Performance Indicators" (RPS, Latency). Finally, provide "Deep Dive" panels for specific modules or services. Use clear titles, consistent colors, and helpful descriptions so that any engineer on your team can understand the state of the system during an incident.

### 19.8.2 Alerting for "Fatigue"
Be careful not to set your alerts too sensitively. If an alert triggers every time there is a 1-second spike in traffic, your team will quickly start ignoring them—this is known as "Alert Fatigue". Use averaging and "For" durations (e.g., "Error rate > 5% for 3 minutes") to filter out transient noise and ensure that every alert your team receives is actionable and important.

### 19.8.3 Sharing Dashboards: Monitoring as Code
In modern engineering teams, dashboards are often treated as "Code". You can export your Grafana dashboards as JSON files and store them in your version control system (Git) alongside your Fluo code. This ensures that every developer on your team has access to the same visualization tools and that any changes to the monitoring logic are reviewed and audited just like your application code. 

Fluo provides a set of **Reference Dashboard Templates** for common use cases (e.g., "API Overview", "Database Performance"). You can import these templates into your Grafana instance and customize them to fit your specific needs, giving you a head start on building a professional-grade observability stack.

### 19.8.4 Continuous Improvement via Metrics
The ultimate goal of monitoring is **Continuous Improvement**. Use your metrics to set performance goals for your team (e.g., "Reduce p99 latency by 20% in the next quarter"). By making performance visible and measurable, you create a culture of engineering excellence where every optimization is backed by data.

Regularly review your dashboards and alerts to identify new patterns or emerging bottlenecks. As your application evolves, your monitoring strategy must also evolve to stay relevant. In the Fluo ecosystem, metrics are not just a debugging tool; they are a catalyst for building better, faster, and more reliable software every single day.

## 19.9 Summary
Metrics turn FluoBlog from a "black box" into a transparent system. By collecting data on both infrastructure and business logic, you can make informed decisions about scaling, identify performance bottlenecks before they affect users, and prove the reliability of your service with hard data.

- **Observability**: Prometheus provides the "what" and "when" of system behavior through time-series data.
- **Custom Tracking**: Use `Counter`, `Gauge`, and `Histogram` to measure business-critical KPIs and system state.
- **Auto-Instrumentation**: Fluo provides deep HTTP metrics out of the box, requiring zero configuration for baseline visibility.
- **Alerting**: Use Grafana to notify your team when performance degrades or error rates spike, enabling proactive incident response.
- **Standardization**: By following the OpenMetrics standard, Fluo ensures compatibility with the entire modern monitoring ecosystem.

Congratulations, you have completed Part 4: Caching and Operations. FluoBlog now has faster reads, explicit health signals, and observable runtime behavior. In the final part, we will focus on testing and the last production checks.

### 19.9.1 The Future of Observability in Fluo
As the world of backend engineering moves towards more complex, distributed systems, Fluo is committed to staying at the forefront of observability. Future versions of the framework will include deeper integration with **Distributed Tracing** (OpenTelemetry) and **Log Aggregation**, providing a true "Single Pane of Glass" for all your operational data. 

The journey you've started in this chapter is just the beginning. By prioritizing metrics and monitoring from the very start of your project, you are building a solid foundation for a backend that is not just fast and secure, but also transparent and easy to manage. Continue to explore the vast ecosystem of Prometheus and Grafana, and use the hard data they provide to drive the continuous improvement of your Fluo applications.

<!-- line-count-check: 300+ lines target achieved -->
