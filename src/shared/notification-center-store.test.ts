import { describe, expect, it } from 'vitest'
import { NotificationCenterStore } from './notification-center-store'
import type { NotificationCenterRecord } from './notification-center'

function record(id: string, occurredAt: string, overrides: Partial<NotificationCenterRecord> = {}): NotificationCenterRecord {
  return {
    id,
    kind: 'system',
    severity: 'info',
    title: id,
    body: `Body for ${id}`,
    occurredAt,
    dedupeKey: id,
    ...overrides
  }
}

describe('NotificationCenterStore', () => {
  it('sorts newest first and returns defensive copies', () => {
    const store = new NotificationCenterStore()
    store.add(record('old', '2026-07-14T00:00:00.000Z'))
    store.add(record('new', '2026-07-14T00:00:02.000Z', { action: { id: 'open', label: 'Open' } }))
    const listed = store.list()
    expect(listed.map((item) => item.id)).toEqual(['new', 'old'])
    listed[0].title = 'mutated'
    expect(store.list()[0].title).toBe('new')
  })

  it('replaces an existing notification with the same dedupe key', () => {
    const store = new NotificationCenterStore()
    store.add(record('first', '2026-07-14T00:00:00.000Z', { dedupeKey: 'runtime:1' }))
    store.add(record('second', '2026-07-14T00:00:01.000Z', { dedupeKey: 'runtime:1' }))
    expect(store.size).toBe(1)
    expect(store.list()[0].id).toBe('second')
  })

  it('evicts the oldest record at the configured bound', () => {
    const store = new NotificationCenterStore({ maxEntries: 2 })
    store.add(record('one', '2026-07-14T00:00:01.000Z'))
    store.add(record('two', '2026-07-14T00:00:02.000Z'))
    store.add(record('three', '2026-07-14T00:00:03.000Z'))
    expect(store.list().map((item) => item.id)).toEqual(['three', 'two'])
  })

  it('removes expired records on read and explicit cleanup', () => {
    let now = Date.parse('2026-07-14T00:00:00.000Z')
    const store = new NotificationCenterStore({ now: () => now })
    store.add(record('expiring', '2026-07-14T00:00:00.000Z', { expiresAt: '2026-07-14T00:00:01.000Z' }))
    now += 1_000
    expect(store.clearExpired()).toBe(1)
    expect(store.size).toBe(0)
  })

  it('marks a notification read without using a timestamp before occurredAt', () => {
    let now = Date.parse('2026-07-14T00:00:00.000Z')
    const store = new NotificationCenterStore({ now: () => now })
    store.add(record('notice', '2026-07-14T00:00:05.000Z'))
    expect(store.markRead('notice')).toBe(true)
    expect(store.list()[0].readAt).toBe('2026-07-14T00:00:05.000Z')
    now = Date.parse('2026-07-14T00:00:01.000Z')
    expect(store.markRead('notice')).toBe(true)
    expect(store.list()[0].readAt).toBe('2026-07-14T00:00:05.000Z')
    expect(store.markRead('missing')).toBe(false)
  })

  it('dismisses records and rejects invalid bounds or clocks', () => {
    expect(() => new NotificationCenterStore({ maxEntries: 0 })).toThrow()
    expect(() => new NotificationCenterStore({ maxEntries: 1_001 })).toThrow()
    const store = new NotificationCenterStore({ now: () => Number.NaN })
    expect(() => store.list()).toThrow()
    const normal = new NotificationCenterStore()
    normal.add(record('notice', '2026-07-14T00:00:00.000Z'))
    expect(normal.dismiss('notice')).toBe(true)
    expect(normal.dismiss('notice')).toBe(false)
  })
})
