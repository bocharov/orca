import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { RuntimeGitCommands, type ResolvedRuntimeGitWorktree } from './orca-runtime-git'

const mocks = vi.hoisted(() => ({
  continueMerge: vi.fn(),
  continueRebase: vi.fn(),
  continueCherryPick: vi.fn(),
  getSshGitProvider: vi.fn()
}))

vi.mock('../git/sequencer-actions', () => ({
  continueMerge: mocks.continueMerge,
  continueRebase: mocks.continueRebase,
  continueCherryPick: mocks.continueCherryPick
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: mocks.getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE: 'unavailable'
}))

const CASES = [
  ['continueRuntimeGitMerge', 'continueMerge'],
  ['continueRuntimeGitRebase', 'continueRebase'],
  ['continueRuntimeGitCherryPick', 'continueCherryPick']
] as const

function makeCommands(connectionId?: string): RuntimeGitCommands {
  const worktree = { id: 'wt-1', repoId: 'repo-1', path: '/repo' } as ResolvedRuntimeGitWorktree
  return new RuntimeGitCommands({
    resolveRuntimeGitTarget: async () => ({
      worktree,
      ...(connectionId ? { connectionId } : {})
    }),
    getRuntimeSettings: () => ({}) as GlobalSettings
  })
}

describe('RuntimeGitCommands sequencer continue', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
  })

  it.each(CASES)('%s runs %s against the resolved worktree', async (command, gitFn) => {
    mocks[gitFn].mockResolvedValue(undefined)

    await expect(makeCommands()[command]('id:wt-1')).resolves.toEqual({ ok: true })

    expect(mocks[gitFn]).toHaveBeenCalledWith('/repo', {})
  })

  it.each(CASES)('%s routes through the SSH git provider', async (command, gitFn) => {
    const provider = { [gitFn]: vi.fn().mockResolvedValue(undefined) }
    mocks.getSshGitProvider.mockReturnValue(provider)

    await expect(makeCommands('conn-1')[command]('id:wt-1')).resolves.toEqual({ ok: true })

    expect(provider[gitFn]).toHaveBeenCalledWith('/repo')
    expect(mocks[gitFn]).not.toHaveBeenCalled()
  })

  it.each(CASES)('%s fails when the SSH git provider is missing', async (command, gitFn) => {
    mocks.getSshGitProvider.mockReturnValue(null)

    await expect(makeCommands('conn-1')[command]('id:wt-1')).rejects.toThrow()
    expect(mocks[gitFn]).not.toHaveBeenCalled()
  })
})
