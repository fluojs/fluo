import { describe, expect, it } from 'vitest';

import { Expose, serialize, Transform } from './index.js';

describe('serialization metadata inheritance', () => {
  it('executes a base transform once for a decorated child without field metadata', () => {
    // Given
    let transformCalls = 0;

    class BaseView {
      @Transform((value) => {
        transformCalls += 1;
        return `${String(value)}B`;
      })
      label: string;

      constructor(label: string) {
        this.label = label;
      }
    }

    @Expose()
    class ChildView extends BaseView {}

    // When
    const serialized = serialize(new ChildView('x'));

    // Then
    expect(serialized).toEqual({ label: 'xB' });
    expect(transformCalls).toBe(1);
  });

  it('does not amplify transforms through decorated deep inheritance', () => {
    // Given
    let transformCalls = 0;

    class BaseView {
      @Transform((value) => {
        transformCalls += 1;
        return `${String(value)}B`;
      })
      label: string;

      constructor(label: string) {
        this.label = label;
      }
    }

    function createDecoratedChild(parent: typeof BaseView): typeof BaseView {
      @Expose()
      class ChildView extends parent {}

      return ChildView;
    }

    let DeepestView = BaseView;

    for (let depth = 0; depth < 51; depth += 1) {
      DeepestView = createDecoratedChild(DeepestView);
    }

    // When
    const serialized = serialize(new DeepestView('x'));

    // Then
    expect(serialized).toEqual({ label: 'xB' });
    expect(transformCalls).toBe(1);
  });
});
