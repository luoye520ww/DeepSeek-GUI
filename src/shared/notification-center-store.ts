import { isNotificationExpired, type NotificationCenterRecord } from './notification-center'

export type NotificationCenterStoreOptions = {
  maxEntries?: number
  now?: () => number
}

const DEFAULT_MAX_ENTRIES = 100
const MAX_ENTRIES = 1_000

function boundedMaxEntries(value: number | undefined): number {
  const candidate = value ?? DEFAULT_MAX_ENTRIES
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_ENTRIES) {
    throw new TypeError('notification store maxEntries is invalid')
  }
  return candidate
}

function currentTimestamp(now: () => number): number {
  const timestamp = now()
  if (!Number.isFinite(timestamp)) throw new TypeError('notification store clock is invalid')
  return timestamp
}

function cloneRecord(record: NotificationCenterRecord): NotificationCenterRecord {
  return { ...record, ...(record.action ? { action: { ...record.action } } : {}) }
}

/** Bounded in-memory notification projection. Persistence and UI are separate concerns. */
export class NotificationCenterStore {
  private readonly records = new Map<string, NotificationCenterRecord>()
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: NotificationCenterStoreOptions = {}) {
    this.maxEntries = boundedMaxEntries(options.maxEntries)
    this.now = options.now ?? Date.now
  }

  add(record: NotificationCenterRecord): void {
    const timestamp = currentTimestamp(this.now)
    this.pruneExpired(timestamp)
    for (const [id, existing] of this.records) {
      if (existing.dedupeKey === record.dedupeKey || id === record.id) this.records.delete(id)
    }
    this.records.set(record.id, cloneRecord(record))
    this.evictOverflow()
  }

  list(): NotificationCenterRecord[] {
    this.pruneExpired(currentTimestamp(this.now))
    return [...this.records.values()]
      .sort((left, right) => {
        const timeDifference = Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
        return timeDifference || left.id.localeCompare(right.id)
      })
      .map(cloneRecord)
  }

  markRead(id: string): boolean {
    const record = this.records.get(id)
    if (!record) return false
    const timestamp = currentTimestamp(this.now)
    const occurredAt = Date.parse(record.occurredAt)
    if (!Number.isFinite(occurredAt)) throw new TypeError('notification occurredAt is invalid')
    const previousReadAt = record.readAt ? Date.parse(record.readAt) : Number.NEGATIVE_INFINITY
    if (record.readAt && !Number.isFinite(previousReadAt)) throw new TypeError('notification readAt is invalid')
    record.readAt = new Date(Math.max(timestamp, occurredAt, previousReadAt)).toISOString()
    return true
  }

  dismiss(id: string): boolean {
    return this.records.delete(id)
  }

  clearExpired(): number {
    return this.pruneExpired(currentTimestamp(this.now))
  }

  get size(): number {
    this.pruneExpired(currentTimestamp(this.now))
    return this.records.size
  }

  private pruneExpired(timestamp: number): number {
    let removed = 0
    for (const [id, record] of this.records) {
      if (isNotificationExpired(record, timestamp)) {
        this.records.delete(id)
        removed += 1
      }
    }
    return removed
  }

  private evictOverflow(): void {
    while (this.records.size > this.maxEntries) {
      const oldest = [...this.records.values()].sort((left, right) => {
        const timeDifference = Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
        return timeDifference || left.id.localeCompare(right.id)
      })[0]
      if (!oldest) return
      this.records.delete(oldest.id)
    }
  }
}
