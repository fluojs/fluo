import { describe, expect, it, vi } from 'vitest'

import { cloneMutableValue } from './metadata/shared.js'
import { cloneWithFallback, fallbackClone } from './utils.js'

describe('fallbackClone', () => {
  it('preserves circular references, symbol keys, and custom prototypes', () => {
    const marker = Symbol('marker')

    class RichValue {
      name: string
      self?: unknown

      constructor(name: string) {
        this.name = name
      }

      getLabel() {
        return `value:${this.name}`
      }
    }

    const source = new RichValue('root') as RichValue & { child?: unknown; [marker]?: unknown }
    source.child = { nested: true }
    source.self = source
    source[marker] = { enabled: true }

    const cloned = fallbackClone(source)

    expect(cloned).toBeInstanceOf(RichValue)
    expect(cloned).not.toBe(source)
    expect(cloned.getLabel()).toBe('value:root')
    expect(cloned.self).toBe(cloned)
    expect(cloned.child).toEqual({ nested: true })
    expect(cloned.child).not.toBe(source.child)
    expect(cloned[marker]).toEqual({ enabled: true })
    expect(cloned[marker]).not.toBe(source[marker])
  })
})

describe('cloneWithFallback', () => {
  it('preserves the issue #4014 event prototype regardless of function siblings', () => {
    class Ev {
      id = 1
      get label() {
        return `x${this.id}`
      }
    }
    const source = new Ev()
    const fn = () => {}

    const direct = cloneWithFallback(source)
    const container = cloneWithFallback({ ev: source, fn })
    const nested = container.ev

    expect(container.fn).toBe(fn)
    for (const cloned of [direct, nested]) {
      expect(cloned).not.toBe(source)
      expect(cloned).toBeInstanceOf(Ev)
      expect(cloned.label).toBe('x1')
    }
  })

  it.each(['native', 'throwing', 'missing'] as const)(
    'preserves nested prototypes and own keys with %s structuredClone',
    (mode) => {
      class Value {
        id = 1
        get label() {
          return `x${this.id}`
        }
        describe() {
          return this.label
        }
      }
      const marker = Symbol('marker')
      const value = new Value()
      const source = {
        value,
        array: [value],
        map: new Map([[value, value]]),
        set: new Set([value]),
        [marker]: { value },
      }
      Object.defineProperty(source, 'hidden', { value: { value }, enumerable: false })
      if (mode === 'throwing') {
        vi.stubGlobal('structuredClone', () => {
          throw new DOMException('', 'DataCloneError')
        })
      } else if (mode === 'missing') {
        vi.stubGlobal('structuredClone', undefined)
      }

      try {
        const cloned = cloneWithFallback(source)

        expect(Reflect.ownKeys(cloned)).toEqual(Reflect.ownKeys(source))
        expect(Object.getOwnPropertyDescriptor(cloned, 'hidden')?.enumerable).toBe(false)
        expect(cloned[marker]).not.toBe(source[marker])
        expect(cloned[marker].value).toBe(cloned.value)
        expect(cloned.array[0]).toBe(cloned.value)
        expect(cloned.map.get(cloned.value)).toBe(cloned.value)
        expect(cloned.set.has(cloned.value)).toBe(true)
        expect(cloned.value).not.toBe(value)
        expect(Object.getPrototypeOf(cloned.value)).toBe(Value.prototype)
        expect(cloned.value.describe()).toBe('x1')
        cloned.value.id = 2
        expect(value.id).toBe(1)
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it('keeps plain data detached with native structuredClone available', () => {
    const matcher = /clone/gi
    matcher.lastIndex = 2
    const buffer = new Uint8Array([1, 2, 3]).buffer
    const source = {
      plain: { ok: true },
      nullPrototype: Object.create(null),
      date: new Date('2026-01-02T03:04:05Z'),
      matcher,
      buffer,
      bytes: new Uint8Array([3, 2, 1]),
      view: new DataView(buffer),
    }

    const cloned = cloneWithFallback(source)

    expect(Object.getPrototypeOf(cloned.plain)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(cloned.nullPrototype)).toBeNull()
    expect(cloned.date).toEqual(source.date)
    expect(cloned.matcher.lastIndex).toBe(2)
    expect(cloned.buffer).toEqual(buffer)
    expect(cloned.bytes).toEqual(source.bytes)
    expect(cloned.view.getUint8(1)).toBe(2)
    for (const key of ['plain', 'nullPrototype', 'date', 'matcher', 'buffer', 'bytes', 'view'] as const) {
      expect(cloned[key]).not.toBe(source[key])
    }
    for (const primitive of [undefined, null, true, 1, 2n, 'value', Symbol('value')]) {
      expect(cloneWithFallback(primitive)).toBe(primitive)
    }
  })

  it('uses the fallback clone for circular, symbol-keyed, and complex nested values', () => {
    // Given
    const marker = Symbol('marker')
    type CircularFixture = {
      readonly nested: {
        readonly createdAt: Date
        readonly keyed: Map<string, Set<Uint8Array>>
        readonly matcher: RegExp
      }
      self?: CircularFixture
      readonly [marker]: { readonly enabled: boolean }
    }
    const source: CircularFixture = {
      nested: {
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        keyed: new Map([['payload', new Set([new Uint8Array([3, 1, 4])])]]),
        matcher: /fallback/gi,
      },
      [marker]: { enabled: true },
    }
    source.nested.matcher.lastIndex = 2
    source.self = source
    const structuredCloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(() => {
      throw new DOMException('', 'DataCloneError')
    })

    try {
      // When
      const cloned = cloneWithFallback(source)

      // Then
      expect(cloned).not.toBe(source)
      expect(cloned.self).toBe(cloned)
      expect(cloned[marker]).toEqual({ enabled: true })
      expect(cloned[marker]).not.toBe(source[marker])
      expect(cloned.nested).not.toBe(source.nested)
      expect(cloned.nested.createdAt).toEqual(new Date('2026-01-02T03:04:05.000Z'))
      expect(cloned.nested.createdAt).not.toBe(source.nested.createdAt)
      expect(cloned.nested.matcher).toEqual(/fallback/gi)
      expect(cloned.nested.matcher.lastIndex).toBe(2)
      expect(cloned.nested.matcher).not.toBe(source.nested.matcher)
      expect(cloned.nested.keyed).not.toBe(source.nested.keyed)

      const clonedSet = cloned.nested.keyed.get('payload')
      const sourceSet = source.nested.keyed.get('payload')
      const clonedBytes = clonedSet?.values().next().value
      const sourceBytes = sourceSet?.values().next().value

      expect(clonedSet).toEqual(new Set([new Uint8Array([3, 1, 4])]))
      expect(clonedSet).not.toBe(sourceSet)
      expect(clonedBytes).toEqual(new Uint8Array([3, 1, 4]))
      expect(clonedBytes).not.toBe(sourceBytes)
    } finally {
      structuredCloneSpy.mockRestore()
    }
  })
})

describe('cloneMutableValue', () => {
  it('reuses the hardened fallback clone path for richer metadata payloads', () => {
    const marker = Symbol('marker')
    const source = {
      nested: { ok: true },
      self: undefined as unknown,
      [marker]: new Map([[{ key: 'entry' }, new Set([{ deep: true }])]]),
    }

    source.self = source

    const cloned = cloneMutableValue(source)

    expect(cloned).not.toBe(source)
    expect(cloned.self).toBe(cloned)
    expect(cloned.nested).toEqual({ ok: true })
    expect(cloned.nested).not.toBe(source.nested)
    expect(cloned[marker]).toBeInstanceOf(Map)

    const [clonedKey, clonedValue] = Array.from(cloned[marker].entries())[0] ?? []
    const [originalKey] = Array.from(source[marker].keys())
    const [firstSetValue] = Array.from((clonedValue as Set<{ deep: boolean }>).values())

    expect(clonedKey).toEqual({ key: 'entry' })
    expect(clonedKey).not.toBe(originalKey)
    expect(clonedValue).toBeInstanceOf(Set)
    expect(firstSetValue).toEqual({ deep: true })
  })
})
