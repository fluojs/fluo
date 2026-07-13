import type { ReactReadonlySearchParams } from './types.js';

/** Immutable wrapper around a native `URLSearchParams` snapshot. */
export class ReadonlySearchParams implements ReactReadonlySearchParams {
  readonly #searchParams: URLSearchParams;

  constructor(search: string) {
    this.#searchParams = new URLSearchParams(search);
  }

  get size(): number {
    return this.#searchParams.size;
  }

  [Symbol.iterator](): URLSearchParamsIterator<[string, string]> {
    return this.#searchParams[Symbol.iterator]();
  }

  entries(): URLSearchParamsIterator<[string, string]> {
    return this.#searchParams.entries();
  }

  forEach(callback: (value: string, key: string, searchParams: ReactReadonlySearchParams) => void): void {
    this.#searchParams.forEach((value, key) => {
      callback(value, key, this);
    });
  }

  get(name: string): string | null {
    return this.#searchParams.get(name);
  }

  getAll(name: string): string[] {
    return this.#searchParams.getAll(name);
  }

  has(name: string, value?: string): boolean {
    return value === undefined ? this.#searchParams.has(name) : this.#searchParams.has(name, value);
  }

  keys(): URLSearchParamsIterator<string> {
    return this.#searchParams.keys();
  }

  toString(): string {
    return this.#searchParams.toString();
  }

  values(): URLSearchParamsIterator<string> {
    return this.#searchParams.values();
  }
}
