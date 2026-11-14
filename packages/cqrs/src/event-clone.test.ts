import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIsolatedEvent } from './event-clone.js'

const originalStructuredClone = globalThis.structuredClone

afterEach(() => {
  globalThis.structuredClone = originalStructuredClone
})

describe('createIsolatedEvent', () => {
  it.each(['native', 'throwing'] as const)(
    'isolates nested value objects with their prototype with %s structuredClone',
    (mode) => {
      class ValueObject {
        id = 1
        get label() {
          return `x${this.id}`
        }
      }
      class DomainEvent {
        constructor(public readonly value: ValueObject) {}
      }
      const payload = new DomainEvent(new ValueObject())
      if (mode === 'throwing') {
        globalThis.structuredClone = vi.fn(() => {
          throw new DOMException('', 'DataCloneError')
        })
      }

      const isolated = createIsolatedEvent(DomainEvent, payload)

      expect(isolated).toBeInstanceOf(DomainEvent)
      expect(isolated).not.toBe(payload)
      expect(isolated.value).toBeInstanceOf(ValueObject)
      expect(isolated.value).not.toBe(payload.value)
      expect(isolated.value.label).toBe('x1')
      isolated.value.id = 2
      expect(payload.value.id).toBe(1)
    },
  )

  it('preserves symbol-keyed own properties on the normal structuredClone path', () => {
    const marker = Symbol('marker')
    const nonEnumMarker = Symbol('nonEnumMarker')

    class DomainEvent {
      value?: { ok: boolean }
      [marker]?: { nested: boolean }
      [nonEnumMarker]?: { secret: string }
    }

    const payload: Record<PropertyKey, unknown> = {
      value: { ok: true },
      [marker]: { nested: true },
    }
    Object.defineProperty(payload, nonEnumMarker, {
      configurable: true,
      enumerable: false,
      value: { secret: 'hidden' },
      writable: true,
    })

    const isolated = createIsolatedEvent(DomainEvent, payload)

    expect(isolated).toBeInstanceOf(DomainEvent)
    expect(isolated).not.toBe(payload)
    expect(isolated.value).toEqual({ ok: true })
    expect(isolated.value).not.toBe(payload.value)
    expect(isolated[marker]).toEqual({ nested: true })
    expect(isolated[marker]).not.toBe(payload[marker])
    expect(isolated[nonEnumMarker]).toEqual({ secret: 'hidden' })
    expect(isolated[nonEnumMarker]).not.toBe(payload[nonEnumMarker])
    expect(Object.prototype.propertyIsEnumerable.call(isolated, nonEnumMarker)).toBe(false)
  })

  it('uses the shared core fallback clone for symbol-keyed payload state', () => {
    const marker = Symbol('marker')

    class DomainEvent {
      value?: { ok: boolean }
      [marker]?: { nested: boolean }
    }

    const payload = {
      value: { ok: true },
      [marker]: { nested: true },
    }

    globalThis.structuredClone = vi.fn(() => {
      throw new Error('fallback please')
    })

    const isolated = createIsolatedEvent(DomainEvent, payload)

    expect(isolated).toBeInstanceOf(DomainEvent)
    expect(isolated).not.toBe(payload)
    expect(isolated.value).toEqual({ ok: true })
    expect(isolated.value).not.toBe(payload.value)
    expect(isolated[marker]).toEqual({ nested: true })
    expect(isolated[marker]).not.toBe(payload[marker])
  })

  it('copies Buffer payloads and shares nested private-member value objects by reference', () => {
    class Secret {
      #value = 's1'

      get value() {
        return this.#value
      }
    }
    class DomainEvent {
      constructor(
        public readonly bytes: Buffer,
        public readonly secret: Secret,
      ) {}
    }
    const payload = new DomainEvent(Buffer.from('ab'), new Secret())

    const isolated = createIsolatedEvent(DomainEvent, payload)

    expect(Buffer.isBuffer(isolated.bytes)).toBe(true)
    expect(isolated.bytes).not.toBe(payload.bytes)
    expect(isolated.bytes.toString()).toBe('ab')
    expect(isolated.secret).toBe(payload.secret)
    expect(isolated.secret.value).toBe('s1')
  })
})
