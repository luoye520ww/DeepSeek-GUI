import { describe, expect, it, vi } from 'vitest'
import { createRemotePortForwardRuntime } from './remote-port-forward-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { RemoteExecutionHandle } from '../../ports/remote-execution.js'
import type { SshChildProcess } from '../../remote/ssh-executor.js'

function fakeChild(): SshChildProcess {
  return { stdout: null, stderr: null, on: () => undefined, kill: vi.fn() } as unknown as SshChildProcess
}

function sshContext(input: { production?: boolean; awaitApproval?: ToolHostContext['awaitApproval'] } = {}): ToolHostContext {
  const production = input.production ?? false
  const handle = {
    describe: () => ({ target: { kind: 'ssh', alias: 'prod' }, status: 'connected', production }),
    production
  } as unknown as RemoteExecutionHandle
  return {
    threadId: 't',
    turnId: 'tn',
    workspace: '/ws',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: input.awaitApproval ?? vi.fn(async () => 'allow' as const),
    executionTarget: handle
  }
}

function localContext(): ToolHostContext {
  return {
    threadId: 't',
    turnId: 'tn',
    workspace: '/ws',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: vi.fn(async () => 'allow' as const)
  }
}

describe('remote_port_forward tool', () => {
  it('opens a tunnel and returns a local preview url once it is ready', async () => {
    const spawn = vi.fn(() => fakeChild())
    const runtime = createRemotePortForwardRuntime({ spawn, allocatePort: async () => 54321, probeReady: async () => true })
    const result = await runtime.provider.tools[0].execute({ action: 'open', remotePort: 3000 }, sshContext())
    const out = result.output as Record<string, unknown>
    expect(out.url).toBe('http://127.0.0.1:54321')
    expect(out.status).toBe('ready')
  })

  it('refuses on a local thread', async () => {
    const runtime = createRemotePortForwardRuntime({ spawn: () => fakeChild(), allocatePort: async () => 5000, probeReady: async () => true })
    const result = await runtime.provider.tools[0].execute({ action: 'open', remotePort: 3000 }, localContext())
    expect(result.isError).toBe(true)
  })

  it('does not allocate or spawn when listing an empty thread', async () => {
    const spawn = vi.fn(() => fakeChild())
    const allocatePort = vi.fn(async () => 5000)
    const runtime = createRemotePortForwardRuntime({ spawn, allocatePort, probeReady: async () => true })
    const result = await runtime.provider.tools[0].execute({ action: 'list' }, sshContext())
    expect((result.output as { forwards: unknown[] }).forwards).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
    expect(allocatePort).not.toHaveBeenCalled()
  })

  it('uses distinct approval ids for repeated production tunnels in one turn', async () => {
    const approvalIds: string[] = []
    const awaitApproval: ToolHostContext['awaitApproval'] = async (approval) => {
      approvalIds.push(approval.id)
      return 'allow'
    }
    const runtime = createRemotePortForwardRuntime({ spawn: () => fakeChild(), allocatePort: async () => 5000, probeReady: async () => true })
    await runtime.provider.tools[0].execute({ action: 'open', remotePort: 3000 }, sshContext({ production: true, awaitApproval }))
    await runtime.provider.tools[0].execute({ action: 'open', remotePort: 3001 }, sshContext({ production: true, awaitApproval }))
    expect(approvalIds).toHaveLength(2)
    expect(approvalIds[0]).not.toBe(approvalIds[1])
  })

  it('validates the remote port', async () => {
    const runtime = createRemotePortForwardRuntime({ spawn: () => fakeChild(), allocatePort: async () => 5000, probeReady: async () => true })
    const result = await runtime.provider.tools[0].execute({ action: 'open', remotePort: 0 }, sshContext())
    expect(result.isError).toBe(true)
  })

  it('disposes per thread', async () => {
    const child = fakeChild()
    const runtime = createRemotePortForwardRuntime({ spawn: () => child, allocatePort: async () => 5000, probeReady: async () => true })
    await runtime.provider.tools[0].execute({ action: 'open', remotePort: 8080 }, sshContext())
    runtime.disposeThreadResources('t')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    const listed = await runtime.provider.tools[0].execute({ action: 'list' }, sshContext())
    expect((listed.output as { forwards: unknown[] }).forwards).toHaveLength(0)
  })
})
