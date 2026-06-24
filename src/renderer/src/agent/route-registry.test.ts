import { describe, expect, it } from 'vitest'
import { KUN_RUNTIME_TOOLS_PATH } from '@shared/kun-endpoints'
import { RouteRegistry } from './route-registry'

describe('RouteRegistry', () => {
  it('keeps stable default keys when loading unkeyed server routes', async () => {
    const registry = new RouteRegistry()

    await registry.init(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        routes: [
          { method: 'GET', path: KUN_RUNTIME_TOOLS_PATH },
          { method: 'GET', path: '/v1/server-only' }
        ]
      })
    }))

    expect(registry.isFromServer()).toBe(true)
    expect(registry.path('runtime.tools')).toBe(KUN_RUNTIME_TOOLS_PATH)
    expect(registry.entries().some((entry) => entry.path === '/v1/server-only')).toBe(true)
  })
})
