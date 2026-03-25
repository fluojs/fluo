export interface ClonedWeakMapStore<TKey extends object, TValue> {
  read(target: TKey): TValue | undefined;
  write(target: TKey, value: TValue): void;
}

export function createClonedWeakMapStore<TKey extends object, TValue>(
  cloneValue: (value: TValue) => TValue,
): ClonedWeakMapStore<TKey, TValue> {
  const store = new WeakMap<TKey, TValue>();

  return {
    read(target: TKey): TValue | undefined {
      const value = store.get(target);
      return value ? cloneValue(value) : undefined;
    },
    write(target: TKey, value: TValue): void {
      store.set(target, cloneValue(value));
    },
  };
}
