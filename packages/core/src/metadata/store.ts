/**
 * Clone-on-read/write metadata store contract for function/object keyed metadata records.
 */
export interface ClonedWeakMapStore<TKey extends object, TValue> {
  read(target: TKey): TValue | undefined;
  update(target: TKey, updateValue: (current: TValue | undefined) => TValue): void;
  write(target: TKey, value: TValue): void;
}

/**
 * Creates a WeakMap-backed store that clones values when they enter or leave the cache.
 *
 * @param cloneValue Clone routine used to isolate stored metadata from caller mutations.
 * @returns A cloned WeakMap store for metadata helpers.
 */
export function createClonedWeakMapStore<TKey extends object, TValue>(
  cloneValue: (value: TValue) => TValue,
): ClonedWeakMapStore<TKey, TValue> {
  const store = new WeakMap<TKey, TValue>();

  return {
    read(target: TKey): TValue | undefined {
      const value = store.get(target);
      return value !== undefined ? cloneValue(value) : undefined;
    },
    update(target: TKey, updateValue: (current: TValue | undefined) => TValue): void {
      store.set(target, cloneValue(updateValue(store.get(target))));
    },
    write(target: TKey, value: TValue): void {
      store.set(target, cloneValue(value));
    },
  };
}
