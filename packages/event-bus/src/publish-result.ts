/** Recipient identity within one publication; transport success does not describe remote subscribers. */
export type EventDeliveryTarget =
  | {
      readonly kind: 'handler';
      /** Zero-based position among matching effective handler registrations, not a persistent identifier. */
      readonly index: number;
      readonly moduleName: string;
      readonly targetName: string;
      readonly methodName: string;
    }
  | { readonly kind: 'transport'; readonly channel: string };

/** Payload-free observation of an attempt; timeout/cancellation never forcibly terminates started work. */
export type EventDeliveryStatus =
  | { readonly status: 'succeeded' }
  | { readonly status: 'failed'; readonly reason: 'handler' | 'transport' | 'not-callable' }
  | { readonly status: 'timed-out'; readonly timeoutMs: number }
  | { readonly status: 'cancelled'; readonly started: boolean };

/** One local handler or outbound transport-channel observation, without payloads, return values, or raw errors. */
export type EventDeliveryOutcome = EventDeliveryStatus & { readonly target: EventDeliveryTarget };

/** Completed observation of the selected scope; `settled` alone does not mean every attempt succeeded. */
export type EventPublishSettlement =
  | { readonly status: 'settled'; readonly outcomes: readonly EventDeliveryOutcome[] }
  | { readonly status: 'no-recipients'; readonly outcomes: readonly [] };

/** Publication admission or observation result, including a completion receipt for background work. */
export type EventPublishResult =
  | EventPublishSettlement
  | { readonly status: 'rejected'; readonly reason: 'stopping' | 'stopped' | 'failed' }
  | { readonly status: 'background'; readonly completion: Promise<EventPublishSettlement> };
