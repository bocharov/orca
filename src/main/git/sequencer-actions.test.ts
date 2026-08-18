import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitRunnerModuleMock } from './status-test-harness'

const { gitExecFileAsyncMock, gitExecFileAsyncBufferMock, gitStreamOptionsMock } = vi.hoisted(
  () => ({
    gitExecFileAsyncMock: vi.fn(),
    gitExecFileAsyncBufferMock: vi.fn(),
    gitStreamOptionsMock: vi.fn()
  })
)

vi.mock('./runner', () =>
  createGitRunnerModuleMock({
    gitExecFileAsyncMock,
    gitExecFileAsyncBufferMock,
    gitStreamOptionsMock
  })
)

import { continueCherryPick, continueMerge, continueRebase } from './sequencer-actions'

type SequencerAction = (worktreePath: string, options?: { wslDistro?: string }) => Promise<void>

const CASES: readonly [string, SequencerAction, string[]][] = [
  ['continueMerge', continueMerge, ['merge', '--continue']],
  ['continueRebase', continueRebase, ['rebase', '--continue']],
  ['continueCherryPick', continueCherryPick, ['cherry-pick', '--continue']]
]

describe('git sequencer actions', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it.each(CASES)('%s runs the matching git command in the worktree', async (_name, run, args) => {
    await run('/repo')

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      args,
      expect.objectContaining({ cwd: '/repo' })
    )
  })

  // Regression guard: without GIT_EDITOR the `--continue` child waits forever on the commit editor.
  it.each(CASES)('%s suppresses the commit-message editor', async (_name, run) => {
    await run('/repo')

    expect(gitExecFileAsyncMock.mock.calls[0][1].env.GIT_EDITOR).toBe('true')
  })

  it('forwards runtime options such as the WSL distro', async () => {
    await continueRebase('/repo', { wslDistro: 'Ubuntu' })

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['rebase', '--continue'],
      expect.objectContaining({ cwd: '/repo', wslDistro: 'Ubuntu' })
    )
  })
})
