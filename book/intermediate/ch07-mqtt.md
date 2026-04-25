<!-- packages: @fluojs/microservices, mqtt -->
<!-- project-state: FluoShop v1.6.0 -->

# Chapter 7. MQTT

This chapter expands FluoShop's messaging scope from server to server communication to edge devices and telemetry ingestion, and explains where MQTT fits. Chapter 6 covered fast internal coordination. Here, the flow widens into physical edge environments with unstable connections and retained state.

## Learning Objectives
- Understand why MQTT fits device and telemetry scenarios.
- Learn how to configure the MQTT transport around namespace, QoS, and retain settings.
- Design MQTT request-reply flows with reply topics and timeout budgets.
- Explain how retained snapshots and telemetry events connect to FluoShop delivery monitoring.
- Summarize MQTT operational metrics and security considerations in edge environments.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, and Chapter 6.
- A basic understanding of topic-based messaging and request-reply patterns.
- Basic familiarity with edge devices, telemetry, and network variability.

## 7.1 Why MQTT in FluoShop

MQTT is topic based and lightweight. It was designed with intermittently connected or resource-constrained clients in mind. That makes it a strong fit for device and telemetry scenarios. FluoShop uses MQTT for delivery and warehouse edge signals. Examples include:

- cold-chain temperature probes for fresh food delivery
- smart locker status updates
- handheld scanner acknowledgments from pickers
- courier ETA beacons

These signals matter operationally. But not every signal needs Kafka-level replay. Instead, many of them need the right QoS and retained state behavior.

## 7.2 MQTT transport setup

Unlike NATS, Kafka, or RabbitMQ, MQTT does not force a fully caller owned broker setup. You can provide an existing client, or you can let the transport configure a URL-based connection directly through the `mqtt` package. This flexibility matches real deployment models. Some teams already manage a shared MQTT client. Other teams prefer transport local ownership.

### 7.2.1 Core options

`MqttMicroserviceTransport` exposes more delivery-shape options than other transports.

- `namespace`
- `eventTopic`
- `messageTopic`
- `replyTopic`
- `requestTimeoutMs`
- `eventQos`, `messageQos`, `responseQos`
- `eventRetain`, `messageRetain`, `responseRetain`

If you provide only a namespace, the transport derives topic names under it. This is a practical default for FluoShop. The system can use `fluoshop.devices` as its namespace and automatically create event, message, and response topics underneath it.

### 7.2.2 Module wiring

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, MqttMicroserviceTransport } from '@fluojs/microservices';

const transport = new MqttMicroserviceTransport({
  url: process.env.MQTT_URL,
  namespace: 'fluoshop.devices',
  eventQos: 1,
  messageQos: 1,
  responseQos: 1,
  eventRetain: false,
  responseRetain: false,
  requestTimeoutMs: 2_000,
});

@Module({
  imports: [MicroservicesModule.forRoot({ transport })],
  providers: [ShipmentTelemetryHandler],
})
export class ShipmentTelemetryModule {}
```

This setup is intentionally simple. The handler model stays stable. The transport changes how messages move, but it does not change how a Provider expresses business logic.

## 7.3 Request-reply over MQTT

Many developers think of MQTT only as event pub/sub, but fluo supports request-reply by publishing message frames with a `replyTopic` and correlating responses with `requestId`. This structure lets FluoShop send device commands and wait for acknowledgments.

### 7.3.1 Device command acknowledgments

For example, suppose you need to confirm that a smart locker actually opened a pickup compartment. The API cannot wait forever, but it does need a bounded response path.

```typescript
@MessagePattern('locker.open-compartment')
async openCompartment(input: { lockerId: string; compartmentId: string }) {
  return await this.lockerGateway.open(input);
}
```

The locker edge service can handle this command and respond through the MQTT response topic. This pattern is useful when the device is MQTT-native but the application still wants to keep a request-style programming model.

### 7.3.2 Reply topics and timeouts

By default, the transport uses an instance-specific reply topic. Tests verify that the generated topic has the form `fluo.microservices.responses.<uuid>` when defaults are used, which matches the same reply isolation idea seen with RabbitMQ and Kafka. In device environments, connection state may be unstable, so timeouts matter more than they do for server to server calls. A locker that fails to respond within the request budget should surface as a temporary edge failure, not as a hanging web request.

## 7.4 Event delivery for telemetry

MQTT becomes more expressive when QoS and retained state are designed together. FluoShop uses both concepts to model real operational signals.

### 7.4.1 Retained state snapshots

A cold-chain sensor can publish the latest trailer temperature. New subscribers usually need to see the most recent value immediately, and this is where a retained message is useful. When you configure a retained event channel for a state snapshot topic, new observers can see the current state instead of waiting for the next natural update. This is not historical replay. It is a last-known-value strategy. That distinction must stay clear during design.

### 7.4.2 QoS trade-offs

QoS settings are not just transport toggles. They are business decisions.

- QoS 0 allows loss in exchange for lower overhead.
- QoS 1 favors at-least-once delivery while accepting the possibility of duplicates.
- QoS 2 is stricter, but also more expensive.

In FluoShop, frequently updated courier ETA beacons may fit QoS 0. A smart-locker open command is more likely to fit QoS 1. A retained warehouse status snapshot can also use QoS 1 so that late subscribers reliably receive brokered state.

## 7.5 FluoShop delivery monitoring

MQTT extends the platform beyond the data center. That changes the operational facts the system can represent. FluoShop now has to treat signals from vehicles, sensors, and lockers as part of the architecture, not just as external noise around server-side state.

### 7.5.1 Cold-chain alerts

When refrigerated delivery crosses a temperature threshold, the edge gateway can publish `shipment.temperature-alert`. The Notification Service, Operations Dashboard, and compliance recorder can each react. None of them needs to sit on the sensor's direct request path. This applies the decoupling principle from earlier transports to physical-world telemetry.

### 7.5.2 Order ETA updates

A courier device can also publish ETA updates. The Customer Experience Service can reduce them into order-tracking status. The key design point is that MQTT does not need to own the final customer-facing representation. It only needs to carry the edge-originated fact into the platform reliably enough for downstream systems to react.

## 7.6 Operations and security

MQTT is often deployed in environments with more network variability and identity diversity than a purely internal service mesh. So FluoShop needs to treat broker auth, topic namespace design, and retained-message scope as security-sensitive architecture choices. Operationally, teams should watch:

- edge client publish failure rate
- timeout rate for request-reply commands
- retained topic sprawl
- duplicate delivery patterns on QoS 1 paths
- reconnect churn from device gateways

These signals show whether MQTT is acting as a healthy edge-ingestion layer or quietly accumulating delivery debt.

## 7.7 FluoShop v1.6.0 progression

After this chapter, FluoShop is no longer just a set of server-side services. It becomes a platform that can absorb device and telemetry inputs. Modern commerce systems often depend on scanners, lockers, courier apps, and sensor networks, so this change makes the architecture more realistic. MQTT provides a transport built for that integration environment.

## 7.8 Summary

- MQTT fits edge, device, and telemetry scenarios where connections are constrained or unstable.
- fluo supports both event and request-reply patterns over MQTT through topic and reply-topic routing.
- QoS and retain settings should follow business semantics, not generic defaults.
- Instance-specific reply topics isolate concurrent request flows.
- FluoShop now uses MQTT to bring locker, courier, and cold-chain signals into the platform.

The larger lesson is again about architecture choices. Transport selection should reflect the shape of the network and the producers creating events on top of it. FluoShop needs MQTT because the system boundary now extends to the physical edge.
