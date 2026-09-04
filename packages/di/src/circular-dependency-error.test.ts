import { describe, expect, it } from 'vitest';

import { CircularDependencyError } from './errors.js';

describe('CircularDependencyError', () => {
  it('provides supported cycle-breaking guidance in structured metadata', () => {
    class ServiceA {}
    class ServiceB {}

    const error = new CircularDependencyError([ServiceA, ServiceB, ServiceA]);

    expect(error.meta).toMatchObject({
      chain: ['ServiceA', 'ServiceB', 'ServiceA'],
      hint: 'Break the constructor cycle by extracting shared logic into a separate provider, introducing a mediator, or moving the interaction to a later boundary. forwardRef() only defers declaration-time token lookup and cannot resolve a true constructor cycle.',
    });
  });
});
