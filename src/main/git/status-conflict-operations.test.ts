import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as BoundedFileReader from '../../shared/node-bounded-file-reader'
import {
  createBoundedFileReaderModuleMock,
  createFsPromisesModuleMock,
  createGitRunnerModuleMock
} from './status-test-harness'

const {
  gitExecFileAsyncMock,
  gitExecFileAsyncBufferMock,
  gitStreamOptionsMock,
  lstatMock,
  realpathMock,
  readFileMock,
  statMock,
  rmMock,
  existsSyncMock
} = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn(),
  gitExecFileAsyncBufferMock: vi.fn(),
  gitStreamOptionsMock: vi.fn(),
  lstatMock: vi.fn(),
  realpathMock: vi.fn(),
  readFileMock: vi.fn(),
  statMock: vi.fn(),
  rmMock: vi.fn(),
  existsSyncMock: vi.fn()
}))

vi.mock('./runner', () =>
  createGitRunnerModuleMock({
    gitExecFileAsyncMock,
    gitExecFileAsyncBufferMock,
    gitStreamOptionsMock
  })
)

vi.mock('fs/promises', () =>
  createFsPromisesModuleMock({ lstatMock, realpathMock, readFileMock, statMock, rmMock })
)

vi.mock('fs', () => ({
  existsSync: existsSyncMock
}))

vi.mock('../../shared/node-bounded-file-reader', async (importOriginal) =>
  createBoundedFileReaderModuleMock(await importOriginal<typeof BoundedFileReader>(), {
    readFileMock,
    statMock
  })
)

import { abortMerge, abortRebase, detectConflictOperation, getStatus } from './status'

describe('abortMerge', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
  })

  it('runs git merge --abort in the worktree', async () => {
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' })

    await abortMerge('/repo')

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['merge', '--abort'], { cwd: '/repo' })
  })
})

describe('abortRebase', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
  })

  it('runs git rebase --abort in the worktree', async () => {
    gitExecFileAsyncMock.mockResolvedValueOnce({ stdout: '' })

    await abortRebase('/repo')

    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['rebase', '--abort'], { cwd: '/repo' })
  })
})
describe('detectConflictOperation', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    existsSyncMock.mockReset()
  })

  it('ignores a stale REBASE_HEAD when no rebase directory exists', async () => {
    readFileMock.mockResolvedValue('gitdir: /repo/.git/worktrees/feature\n')
    existsSyncMock.mockImplementation((target: string) => {
      if (target.endsWith('MERGE_HEAD')) {
        return false
      }
      if (target.endsWith('CHERRY_PICK_HEAD')) {
        return false
      }
      if (target.endsWith('rebase-merge')) {
        return false
      }
      if (target.endsWith('rebase-apply')) {
        return false
      }
      if (target.endsWith('REBASE_HEAD')) {
        return true
      }
      return false
    })

    const result = await detectConflictOperation('/repo')

    expect(result).toBe('unknown')
  })
})

describe('getStatus operationProgress', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
    gitStreamOptionsMock.mockReset()
    readFileMock.mockReset()
    statMock.mockReset()
    existsSyncMock.mockReset()
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '' })
  })

  it('omits operationProgress when a sequencer operation has no rebase state on disk', async () => {
    // Only `.git` itself resolves; every rebase-merge/rebase-apply read misses.
    readFileMock.mockImplementation(async (target: string) =>
      target.endsWith('.git')
        ? 'gitdir: /repo/.git/worktrees/feature\n'
        : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    )
    existsSyncMock.mockImplementation((target: string) => target.endsWith('CHERRY_PICK_HEAD'))

    const result = await getStatus('/repo')

    expect(result.conflictOperation).toBe('cherry-pick')
    expect(result.operationProgress).toBeUndefined()
    expect('operationProgress' in result).toBe(false)
    // The reader ran and degraded — it did not skip the state directory.
    expect(readFileMock).toHaveBeenCalledWith(expect.stringContaining('rebase-merge'), 'utf-8')
  })
})
