import { describe, expect, it } from 'vitest'

import { cloneMutableValue } from './metadata/shared.js'
import { fallbackClone } from './utils.js'

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
