import assert from 'node:assert/strict';
import {
  EVENT_BUS,
  EventBusModule,
  type EventBusWithResults,
  type EventPublishResult,
  OnEvent,
} from '@fluojs/event-bus';
import { FluoFactory, defineModule } from '@fluojs/runtime';

class TokenUsed {
  constructor(readonly tokenRecordId: string) {}
}

class RefreshProjection {
  constructor(readonly postId: string) {}
}

class Bookkeeping {
  @OnEvent(TokenUsed)
  recordLastUsed(_event: TokenUsed) {
    throw new Error('last-used-store-unavailable');
  }
}

class Projection {
  @OnEvent(RefreshProjection)
  refresh(_event: RefreshProjection) {}
}

class BrokenProjection {
  @OnEvent(RefreshProjection)
  refresh(_event: RefreshProjection) {
    throw new Error('projection-store-unavailable');
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [EventBusModule.forRoot()],
  providers: [Bookkeeping, Projection, BrokenProjection],
});

const logs: Array<{ message: string; error?: unknown }> = [];
const app = await FluoFactory.create(AppModule, {
  logger: {
    debug() {},
    log() {},
    warn() {},
    error(message, error) { logs.push({ message, error }); },
  },
});

try {
  const bus = await app.container.resolve<EventBusWithResults>(EVENT_BUS);

  // Authentication has already succeeded. Publish only a database record ID, never the API credential.
  // An isolated last-used listener failure must not turn this principal into an authentication error.
  const principal = { userId: 'user-1', tokenRecordId: 'token-record-1' };
  await bus.publish(new TokenUsed(principal.tokenRecordId));
  assert.equal(principal.userId, 'user-1');
  assert.equal(logs.length, 1);

  // This application's projection policy requires every selected recipient to succeed.
  // Neither "settled" nor an empty recipient list is proof of required work succeeding.
  const result: EventPublishResult = await bus.publishWithResult(new RefreshProjection('post-1'));
  const projectionReady = result.status === 'settled'
    && result.outcomes.every((outcome) => outcome.status === 'succeeded');
  assert.equal(projectionReady, false);
  assert.equal(result.status, 'settled');
  if (result.status !== 'settled') throw new Error('Expected projection observations');
  assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ['succeeded', 'failed']);
  assert.equal(logs.at(-1)?.error, undefined);

  // Background publication returns a receipt, not a success claim.
  const receipt = await bus.publishWithResult(new RefreshProjection('post-1'), { waitForHandlers: false });
  assert.equal(receipt.status, 'background');
  if (receipt.status !== 'background') throw new Error('Expected completion receipt');
  const completion = await receipt.completion;
  assert.equal(completion.status, 'settled');

  console.log(JSON.stringify({
    authenticated: true,
    projectionReady,
    outcomes: result.outcomes,
    background: completion,
  }));
} finally {
  await app.close();
}
