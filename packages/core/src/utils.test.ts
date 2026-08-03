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
      expect(structuredCloneSpy).toHaveBeenCalledTimes(1)
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
