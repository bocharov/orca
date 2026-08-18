import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import {
  abortRuntimeGitMerge,
  abortRuntimeGitRebase,
  continueRuntimeGitCherryPick,
  continueRuntimeGitMerge,
  continueRuntimeGitRebase
} from './runtime-git-client'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'

const gitAbortMerge = vi.fn()
const gitAbortRebase = vi.fn()
const gitSequencer = {
  continueMerge: vi.fn(),
  continueRebase: vi.fn(),
  continueCherryPick: vi.fn()
}
const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()
const runtimeCall = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  gitAbortMerge.mockReset()
  gitAbortRebase.mockReset()
  for (const mock of Object.values(gitSequencer)) {
    mock.mockReset()
    mock.mockResolvedValue(undefined)
  }
  runtimeEnvironmentCall.mockReset()
  runtimeEnvironmentTransportCall.mockReset()
  runtimeCall.mockReset()
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    api: {
      git: { abortMerge: gitAbortMerge, abortRebase: gitAbortRebase, ...gitSequencer },
      runtime: { call: runtimeCall },
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall }
    }
  })
})

describe('runtime git client merge operations', () => {
  it('uses local git IPC when no remote runtime is active', async () => {
    gitAbortMerge.mockResolvedValue(undefined)

    await abortRuntimeGitMerge({
      settings: { activeRuntimeEnvironmentId: null },
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })

    expect(gitAbortMerge).toHaveBeenCalledWith({ connectionId: undefined, worktreePath: '/repo' })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('routes abort merge through the active runtime', async () => {
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-1',
      ok: true,
      result: { success: true },
      _meta: { runtimeId: 'remote-runtime' }
    })

    await abortRuntimeGitMerge({
      settings: { activeRuntimeEnvironmentId: 'env-1' },
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'git.abortMerge',
      params: { worktree: 'id:wt-1' },
      timeoutMs: 30_000
    })
    expect(gitAbortMerge).not.toHaveBeenCalled()
  })

  it('uses local git IPC when aborting a rebase without an active runtime', async () => {
    gitAbortRebase.mockResolvedValue(undefined)

    await abortRuntimeGitRebase({
      settings: { activeRuntimeEnvironmentId: null },
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      connectionId: 'ssh-1'
    })

    expect(gitAbortRebase).toHaveBeenCalledWith({ connectionId: 'ssh-1', worktreePath: '/repo' })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  const SEQUENCER_CASES = [
    [continueRuntimeGitMerge, 'continueMerge', 'git.continueMerge'],
    [continueRuntimeGitRebase, 'continueRebase', 'git.continueRebase'],
    [continueRuntimeGitCherryPick, 'continueCherryPick', 'git.continueCherryPick']
  ] as const

  it.each(SEQUENCER_CASES)('uses local git IPC for %#: %s', async (run, apiMethod) => {
    await run({
      settings: { activeRuntimeEnvironmentId: null },
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      connectionId: 'ssh-1'
    })

    expect(gitSequencer[apiMethod]).toHaveBeenCalledWith({
      connectionId: 'ssh-1',
      worktreePath: '/repo'
    })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it.each(SEQUENCER_CASES)(
    'routes %# through the active runtime as %s',
    async (run, apiMethod, rpcMethod) => {
      runtimeEnvironmentCall.mockResolvedValue({
        id: 'rpc-1',
        ok: true,
        result: { success: true },
        _meta: { runtimeId: 'remote-runtime' }
      })

      await run({
        settings: { activeRuntimeEnvironmentId: 'env-1' },
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      })

      expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
        selector: 'env-1',
        method: rpcMethod,
        params: { worktree: 'id:wt-1' },
        timeoutMs: 30_000
      })
      expect(gitSequencer[apiMethod]).not.toHaveBeenCalled()
    }
  )

  it('routes abort rebase through the active runtime', async () => {
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-1',
      ok: true,
      result: { success: true },
      _meta: { runtimeId: 'remote-runtime' }
    })

    await abortRuntimeGitRebase({
      settings: { activeRuntimeEnvironmentId: 'env-1' },
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'git.abortRebase',
      params: { worktree: 'id:wt-1' },
      timeoutMs: 30_000
    })
    expect(gitAbortRebase).not.toHaveBeenCalled()
  })
})
