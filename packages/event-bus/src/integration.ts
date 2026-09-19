import type { Token } from '@fluojs/core';

/**
 * First-party integration coordinator for adopting shutdown deadlines from an owning orchestrator.
 */
export interface EventBusShutdownCoordinator {
  /**
   * Caps the event bus shutdown drain at a deadline coordinated by an owning integration.
   *
   * @param deadlineAtMs Absolute timestamp in milliseconds.
   */
  adoptShutdownDeadline(deadlineAtMs: number): void;
}

/**
 * Injection token for the first-party event bus shutdown deadline coordinator.
 */
export const EVENT_BUS_SHUTDOWN_COORDINATOR: Token<EventBusShutdownCoordinator> =
  Symbol.for('fluo.event-bus.shutdown-coordinator');
