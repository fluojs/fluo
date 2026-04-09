import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIsolatedEvent } from './event-clone.js'

const originalStructuredClone = globalThis.structuredClone

afterEach(() => {
  globalThis.structuredClone = originalStructuredClone
})

describe('createIsolatedEvent', () => {
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
})
