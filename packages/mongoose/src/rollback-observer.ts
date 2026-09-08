import { AsyncLocalStorage } from 'node:async_hooks';
import {
  TransactionRollbackCapabilityError,
  type TransactionRollbackObserver,
  TransactionRollbackUnconfirmedError,
} from './result-rollback.js';

type RecordValue = Record<string, unknown>;
type Attempt = {
  transactionNumber?: string;
  pending: Set<string>;
  abortSucceeded: boolean;
  abortFailure?: unknown;
  committed: boolean;
};
type Scope = { attempts: Map<string, Attempt>; requests: Map<string, { attempt: Attempt; abort: boolean; commit: boolean; commandName: unknown }> };

function record(value: unknown): RecordValue | undefined {
  return typeof value === 'object' && value !== null ? value as RecordValue : undefined;
}

function sessionKey(value: unknown): string | undefined {
  const session = record(value);
  return session?.id === undefined ? undefined : JSON.stringify(session.id);
}

function requestKey(event: RecordValue): string | undefined {
  if (typeof event.requestId !== 'number' || event.connectionId === undefined) return undefined;
  return `${String(event.connectionId)}:${String(event.serviceId ?? '')}:${event.requestId}`;
}

/**
 * Requires positive, correlated MongoDB abort command acknowledgement for Result rollback.
 *
 * @remarks Create the MongoClient with `monitorCommands: true` before connecting and pass the
 * public `connection.getClient()` result. Manual connection adapters must forward `getClient()`
 * from the session-owning connection. No command event, local session state, and replies
 * containing writeConcernError are not rollback confirmation. No driver methods are patched.
 * @param client Public MongoClient owning the connection's sessions and command events.
 * @returns A capability for the Fluo module/connection `rollbackObserver` option.
 */
export function createMongooseRollbackObserver(client: object): TransactionRollbackObserver {
  const options = record(Reflect.get(client, 'options'));
  const on: unknown = Reflect.get(client, 'on');
  const off: unknown = Reflect.get(client, 'off');
  if (options?.monitorCommands !== true || typeof on !== 'function' || typeof off !== 'function') {
    throw new TransactionRollbackCapabilityError();
  }
  const scopes = new AsyncLocalStorage<Scope>();
  const activeSessions = new Map<string, Scope>();
  const subscriptions = new Set<{
    started(event: unknown): void;
    succeeded(event: unknown): void;
    failed(event: unknown): void;
  }>();
  const dispatchStarted = (event: unknown) => { for (const subscription of subscriptions) subscription.started(event); };
  const dispatchSucceeded = (event: unknown) => { for (const subscription of subscriptions) subscription.succeeded(event); };
  const dispatchFailed = (event: unknown) => { for (const subscription of subscriptions) subscription.failed(event); };
  return {
    async run(callback) {
      const scope: Scope = { attempts: new Map(), requests: new Map() };
      const started = (value: unknown) => {
        const event = record(value);
        const command = record(event?.command);
        if (!event || !command) return;
        const key = sessionKey(command.lsid);
        const attempt = key === undefined ? undefined : scope.attempts.get(key);
        const request = requestKey(event);
        if (!attempt || !request || command.txnNumber === undefined || command.autocommit !== false) return;
        const transactionNumber = String(command.txnNumber);
        if (command.startTransaction === true && attempt.transactionNumber === undefined) {
          attempt.transactionNumber = transactionNumber;
        }
        if (attempt.transactionNumber !== transactionNumber) return;
        attempt.pending.add(request);
        scope.requests.set(request, {
          attempt,
          commandName: event.commandName,
          abort: event.commandName === 'abortTransaction',
          commit: event.commandName === 'commitTransaction',
        });
      };
      const completed = (value: unknown, succeeded: boolean) => {
        const event = record(value);
        const request = event && requestKey(event);
        const entry = request ? scope.requests.get(request) : undefined;
        if (!entry || !request || !event || event.commandName !== entry.commandName) return;
        scope.requests.delete(request);
        entry.attempt.pending.delete(request);
        const reply = record(event.reply);
        const acknowledged = succeeded && reply?.ok === 1 && reply.writeConcernError === undefined;
        if (entry.commit && acknowledged) entry.attempt.committed = true;
        if (entry.abort) {
          entry.attempt.abortSucceeded = acknowledged;
          entry.attempt.abortFailure = acknowledged ? undefined : succeeded
            ? new TransactionRollbackUnconfirmedError({ cause: event.reply })
            : event.failure;
        }
      };
      const succeeded = (event: unknown) => completed(event, true);
      const failed = (event: unknown) => completed(event, false);
      const subscription = { started, succeeded, failed };
      subscriptions.add(subscription);
      if (subscriptions.size === 1) {
        Reflect.apply(on, client, ['commandStarted', dispatchStarted]);
        Reflect.apply(on, client, ['commandSucceeded', dispatchSucceeded]);
        Reflect.apply(on, client, ['commandFailed', dispatchFailed]);
      }
      try {
        return await scopes.run(scope, callback);
      } finally {
        subscriptions.delete(subscription);
        if (subscriptions.size === 0) {
          Reflect.apply(off, client, ['commandStarted', dispatchStarted]);
          Reflect.apply(off, client, ['commandSucceeded', dispatchSucceeded]);
          Reflect.apply(off, client, ['commandFailed', dispatchFailed]);
        }
        for (const key of scope.attempts.keys()) {
          if (activeSessions.get(key) === scope) activeSessions.delete(key);
        }
      }
    },
    beginAttempt(session, connection) {
      const getClient = record(connection)?.getClient;
      if (typeof getClient !== 'function' || Reflect.apply(getClient, connection, []) !== client) {
        throw new TransactionRollbackCapabilityError();
      }
      const scope = scopes.getStore();
      const value = record(session);
      const key = sessionKey(value?.id);
      if (!scope || key === undefined || (activeSessions.has(key) && activeSessions.get(key) !== scope)) {
        throw new TransactionRollbackCapabilityError();
      }
      const previous = scope.attempts.get(key);
      if (previous && previous.pending.size > 0) throw new TransactionRollbackCapabilityError();
      const attempt: Attempt = { pending: new Set(), abortSucceeded: false, committed: false };
      scope.attempts.set(key, attempt);
      activeSessions.set(key, scope);
      return {
        confirmRollback() {
          if (attempt.abortFailure !== undefined) throw attempt.abortFailure;
          if (attempt.transactionNumber === undefined || attempt.pending.size > 0
            || !attempt.abortSucceeded || attempt.committed) {
            throw new TransactionRollbackUnconfirmedError();
          }
          return true;
        },
      };
    },
  };
}
