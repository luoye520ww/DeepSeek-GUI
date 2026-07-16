import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  resolveKunRuntimeSettings
} from '../shared/app-settings'
import { LegacyProviderSettingsMigrationCoordinator } from './legacy-provider-settings-migration'
import { probeSavedModelProvider } from './provider-connection'
import { providersConfigForRuntime } from './runtime/kun-runtime-model-config'
import { syncGuiManagedKunConfig } from './runtime/kun-runtime-config-service'
import { JsonSettingsStore } from './settings-store'

describe('LegacyProviderSettingsMigrationCoordinator', () => {
  it('backs up and removes plaintext while keeping secure bindings readable across restarts', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-settings-credential-migration-'))
    const dataDir = join(userDataDir, 'runtime-data')
    const plainStore = new JsonSettingsStore(userDataDir)
    const defaults = await plainStore.load()
    const providerDefaults = defaultModelProviderSettings()
    const defaultProvider = providerDefaults.providers[0]!
    await plainStore.save({
      ...defaults,
      provider: {
        ...providerDefaults,
        apiKey: 'default-provider-secret',
        providers: [{
          ...defaultProvider,
          apiKey: 'default-provider-secret'
        }, {
          ...defaultProvider,
          id: 'custom-provider',
          name: 'Custom Provider',
          apiKey: 'custom-provider-secret',
          baseUrl: 'https://custom.example/v1',
          models: ['custom-model']
        }]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          dataDir,
          providerId: 'custom-provider',
          model: 'custom-model',
          apiKey: 'distinct-runtime-secret'
        }
      }
    })

    const migration = new LegacyProviderSettingsMigrationCoordinator()
    const store = new JsonSettingsStore(userDataDir, { credentialMigration: migration })
    const loaded = await store.load()
    expect(loaded.provider.providers.find((provider) => provider.id === 'custom-provider')?.apiKey)
      .toBe('custom-provider-secret')
    expect(loaded.agents.kun.apiKey).toBe('distinct-runtime-secret')

    const persisted = await readFile(join(userDataDir, 'kun-settings.json'), 'utf8')
    expect(persisted).not.toContain('default-provider-secret')
    expect(persisted).not.toContain('custom-provider-secret')
    expect(persisted).not.toContain('distinct-runtime-secret')
    const backup = await readFile(
      join(userDataDir, 'kun-settings.pre-extension-credential-migration.json'),
      'utf8'
    )
    expect(backup).toContain('custom-provider-secret')

    const markers = JSON.parse(await readFile(
      join(dataDir, 'extensions', 'legacy-credential-migrations.json'),
      'utf8'
    )) as { entries: Record<string, { accountId: string; providerId: string; modelId?: string; phase: string }> }
    expect(markers.entries['settings:provider:custom-provider']).toEqual(expect.objectContaining({
      providerId: 'custom-provider',
      modelId: 'custom-model',
      phase: 'settings-committed'
    }))
    expect(markers.entries['settings:runtime:override']).toEqual(expect.objectContaining({
      providerId: 'custom-provider',
      modelId: 'custom-model',
      phase: 'settings-committed'
    }))
    expect(markers.entries['settings:provider:custom-provider']?.accountId)
      .not.toBe(markers.entries['settings:runtime:override']?.accountId)
    expect(await readFile(join(dataDir, 'extensions', 'accounts.json'), 'utf8'))
      .not.toContain('custom-provider-secret')
    const providerBindings = await readFile(
      join(dataDir, 'extensions', 'provider-bindings.json'),
      'utf8'
    )
    expect(providerBindings).toContain('legacy:settings:provider:custom-provider')
    expect(providerBindings).toContain('custom-model')
    expect(providerBindings).not.toContain('custom-provider-secret')

    const reloaded = await new JsonSettingsStore(userDataDir, {
      credentialMigration: new LegacyProviderSettingsMigrationCoordinator()
    }).load()
    expect(reloaded.provider.providers.find((provider) => provider.id === 'custom-provider')?.apiKey)
      .toBe('custom-provider-secret')
    expect(reloaded.agents.kun.apiKey).toBe('distinct-runtime-secret')

    const runtimeProviders = providersConfigForRuntime(reloaded)
    expect(runtimeProviders['custom-provider']).toEqual(expect.objectContaining({
      apiKey: '',
      credentialSourceId: 'settings:provider:custom-provider'
    }))
    expect(JSON.stringify(runtimeProviders)).not.toContain('custom-provider-secret')

    await syncGuiManagedKunConfig(dataDir, resolveKunRuntimeSettings(reloaded), {
      scheduleMcp: {
        settings: reloaded,
        launch: { appPath: userDataDir, execPath: process.execPath, isPackaged: false }
      },
      mcpConfigPath: join(userDataDir, 'missing-mcp.json')
    })
    const runtimeConfig = await readFile(join(dataDir, 'config.json'), 'utf8')
    expect(runtimeConfig).not.toContain('default-provider-secret')
    expect(runtimeConfig).not.toContain('custom-provider-secret')
    expect(runtimeConfig).not.toContain('distinct-runtime-secret')
    expect(runtimeConfig).toContain('settings:provider:custom-provider')
    expect(runtimeConfig).toContain('settings:runtime:override')
  })

  it('keeps the account reference stable when a user explicitly updates a migrated key', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-settings-credential-update-'))
    const dataDir = join(userDataDir, 'runtime-data')
    const plainStore = new JsonSettingsStore(userDataDir)
    const defaults = await plainStore.load()
    await plainStore.save({
      ...defaults,
      provider: {
        ...defaultModelProviderSettings(),
        apiKey: 'old-secret'
      },
      agents: { kun: { ...defaultKunRuntimeSettings(), dataDir } }
    })
    const store = new JsonSettingsStore(userDataDir, {
      credentialMigration: new LegacyProviderSettingsMigrationCoordinator()
    })
    const loaded = await store.load()
    const before = await bindingAccountId(dataDir, 'settings:provider:deepseek')

    const updated = await store.patch({
      provider: {
        ...loaded.provider,
        apiKey: 'new-secret',
        providers: loaded.provider.providers.map((provider) => provider.id === 'deepseek'
          ? { ...provider, apiKey: 'new-secret' }
          : provider)
      }
    })
    expect(updated.provider.apiKey).toBe('new-secret')
    expect(await bindingAccountId(dataDir, 'settings:provider:deepseek')).toBe(before)
    expect(await readFile(join(userDataDir, 'kun-settings.json'), 'utf8')).not.toContain('new-secret')
  })

  it('probes a saved provider with its migration-hydrated credential and endpoint format', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-settings-probe-credential-'))
    const dataDir = join(userDataDir, 'runtime-data')
    const plainStore = new JsonSettingsStore(userDataDir)
    const defaults = await plainStore.load()
    const providerDefaults = defaultModelProviderSettings()
    const defaultProvider = providerDefaults.providers[0]!
    await plainStore.save({
      ...defaults,
      provider: {
        ...providerDefaults,
        providers: [defaultProvider, {
          ...defaultProvider,
          id: 'saved-anthropic',
          name: 'Saved Anthropic-compatible provider',
          apiKey: 'protected-probe-secret',
          baseUrl: 'https://api.example.com/v1',
          endpointFormat: 'messages'
        }]
      },
      agents: { kun: { ...defaultKunRuntimeSettings(), dataDir } }
    })
    const store = new JsonSettingsStore(userDataDir, {
      credentialMigration: new LegacyProviderSettingsMigrationCoordinator()
    })
    const hydrated = await store.load()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'Claude/Exact-ID' }] })))
    vi.stubGlobal('fetch', fetchMock)

    try {
      await expect(probeSavedModelProvider('saved-anthropic', hydrated)).resolves.toEqual({
        ok: true,
        latencyMs: expect.any(Number),
        modelIds: ['Claude/Exact-ID']
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'anthropic-version': '2023-06-01',
            'x-api-key': 'protected-probe-secret'
          })
        })
      )
      expect(await readFile(join(userDataDir, 'kun-settings.json'), 'utf8'))
        .not.toContain('protected-probe-secret')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rolls back a secure pending migration when the ordinary settings commit fails', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-settings-credential-failure-'))
    const rollback = vi.fn(async () => undefined)
    const store = new JsonSettingsStore(userDataDir, {
      credentialMigration: {
        prepare: async (settings) => ({
          runtimeSettings: settings,
          persistedSettings: settings,
          sourceIdsToCommit: ['settings:provider:deepseek'],
          removedPlaintext: false,
          rollback,
          commit: async () => undefined
        })
      }
    })
    const settings = await store.load()
    await mkdir(join(userDataDir, 'kun-settings.json'))

    await expect(store.save(settings)).rejects.toBeDefined()
    expect(rollback).toHaveBeenCalledOnce()
  })

  it('does not migrate when an existing backup path is not a protected regular file', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-settings-credential-backup-'))
    const plainStore = new JsonSettingsStore(userDataDir)
    const settings = await plainStore.load()
    await plainStore.save({
      ...settings,
      provider: { ...settings.provider, apiKey: 'plaintext-must-remain-authoritative' }
    })
    await mkdir(join(userDataDir, 'kun-settings.pre-extension-credential-migration.json'))
    const prepare = vi.fn()

    const loaded = await new JsonSettingsStore(userDataDir, {
      credentialMigration: { prepare }
    }).load()

    expect(loaded.provider.apiKey).toBe('plaintext-must-remain-authoritative')
    expect(prepare).not.toHaveBeenCalled()
  })
})

async function bindingAccountId(dataDir: string, sourceId: string): Promise<string> {
  const markers = JSON.parse(await readFile(
    join(dataDir, 'extensions', 'legacy-credential-migrations.json'),
    'utf8'
  )) as { entries: Record<string, { accountId: string }> }
  return markers.entries[sourceId]!.accountId
}
