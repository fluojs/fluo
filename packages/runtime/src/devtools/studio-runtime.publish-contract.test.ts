import { describe, expect, it } from 'vitest';

import type { StudioLiveEvent, StudioLiveSnapshot } from './contracts.js';
import { StudioDevtoolsRuntime } from './studio-runtime.js';

type ExpectedStudioPublishInput<TEvent extends StudioLiveEvent = StudioLiveEvent> = TEvent extends StudioLiveEvent
  ? { payload: TEvent['payload']; type: TEvent['type'] }
  : never;
type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2)
    ? (<T>() => T extends TRight ? 1 : 2) extends (<T>() => T extends TLeft ? 1 : 2)
      ? true
      : false
    : false;
type PublishInput = Parameters<StudioDevtoolsRuntime['publish']>[0];
type InvalidHeartbeatInput = { payload: StudioLiveSnapshot; type: 'heartbeat' };

const publishInputIsCorrelated: IsEqual<PublishInput, ExpectedStudioPublishInput> = true;
const invalidHeartbeatInputIsRejected: InvalidHeartbeatInput extends PublishInput ? false : true = true;

describe('Studio publish type contract', () => {
  it('rejects a payload that belongs to another event discriminant', () => {
    // Given / When
    const publishContract = {
      invalidHeartbeatInputIsRejected,
      publishInputIsCorrelated,
    };

    // Then
    expect(publishContract).toEqual({
      invalidHeartbeatInputIsRejected: true,
      publishInputIsCorrelated: true,
    });
  });
});
