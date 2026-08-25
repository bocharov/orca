import { describe, expect, it, vi } from 'vitest'
import { SshGitProvider } from './ssh-git-provider'

describe('SshGitProvider merge operations', () => {
  it('abortMerge sends git.abortMerge request', async () => {
    const mux = {
      request: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
      onNotification: vi.fn(),
      dispose: vi.fn(),
      isDisposed: vi.fn().mockReturnValue(false)
    }
    const provider = new SshGitProvider('conn-1', mux as never)

    await provider.abortMerge('/home/user/repo')

    expect(mux.request).toHaveBeenCalledWith('git.abortMerge', {
      worktreePath: '/home/user/repo'
    })
  })

  it.each([
    ['continueMerge', 'git.continueMerge'],
    ['continueRebase', 'git.continueRebase'],
    ['continueCherryPick', 'git.continueCherryPick']
  ] as const)('%s sends the %s request', async (method, rpcMethod) => {
    const mux = {
      request: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
      onNotification: vi.fn(),
      dispose: vi.fn(),
      isDisposed: vi.fn().mockReturnValue(false)
    }
    const provider = new SshGitProvider('conn-1', mux as never)

    await provider[method]('/home/user/repo')

    expect(mux.request).toHaveBeenCalledWith(rpcMethod, {
      worktreePath: '/home/user/repo'
    })
  })

  const SEQUENCER_METHODS = [
    ['continueMerge', 'git.continueMerge'],
    ['continueRebase', 'git.continueRebase'],
    ['continueCherryPick', 'git.continueCherryPick']
  ] as const

  it.each(SEQUENCER_METHODS)(
    '%s surfaces a reconnect prompt when an older relay answers -32601',
    async (method, rpcMethod) => {
      const mux = {
        request: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error(`Method not found: ${rpcMethod}`), { code: -32601 })
          ),
        notify: vi.fn(),
        onNotification: vi.fn(),
        dispose: vi.fn(),
        isDisposed: vi.fn().mockReturnValue(false)
      }
      const provider = new SshGitProvider('conn-1', mux as never)

      await expect(provider[method]('/home/user/repo')).rejects.toThrow(/older Orca relay/)
    }
  )

  it.each(SEQUENCER_METHODS)('%s propagates non-compatibility failures', async (method) => {
    const mux = {
      request: vi.fn().mockRejectedValue(new Error('needs merge')),
      notify: vi.fn(),
      onNotification: vi.fn(),
      dispose: vi.fn(),
      isDisposed: vi.fn().mockReturnValue(false)
    }
    const provider = new SshGitProvider('conn-1', mux as never)

    await expect(provider[method]('/home/user/repo')).rejects.toThrow('needs merge')
  })

  it('abortRebase sends git.abortRebase request', async () => {
    const mux = {
      request: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
      onNotification: vi.fn(),
      dispose: vi.fn(),
      isDisposed: vi.fn().mockReturnValue(false)
    }
    const provider = new SshGitProvider('conn-1', mux as never)

    await provider.abortRebase('/home/user/repo')

    expect(mux.request).toHaveBeenCalledWith('git.abortRebase', {
      worktreePath: '/home/user/repo'
    })
  })
})
