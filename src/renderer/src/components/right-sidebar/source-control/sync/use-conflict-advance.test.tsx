// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSourceControlConflictAdvance } from './use-conflict-advance'

const { runners, toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  runners: {
    continueMerge: vi.fn(),
    continueRebase: vi.fn(),
    continueCherryPick: vi.fn()
  }
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: () => null }))
vi.mock('@/runtime/runtime-git-client', () => ({
  continueRuntimeGitMerge: (...a: unknown[]) => runners.continueMerge(...a),
  continueRuntimeGitRebase: (...a: unknown[]) => runners.continueRebase(...a),
  continueRuntimeGitCherryPick: (...a: unknown[]) => runners.continueCherryPick(...a)
}))
vi.mock('./remote-refresh', () => ({ refreshSourceControlAfterRemoteAction: vi.fn() }))

const setAdvanceOperationInFlightByWorktree = vi.fn()
const setRemoteActionErrors = vi.fn()

type AdvanceOptions = Parameters<typeof useSourceControlConflictAdvance>[0]

function setup(overrides: Partial<AdvanceOptions> = {}) {
  return renderHook(() =>
    useSourceControlConflictAdvance({
      activeRepoSettings: null,
      activeWorktreeId: 'wt-1',
      conflictOperation: 'rebase',
      isAdvancingOperation: false,
      isAbortingOperation: false,
      refreshActiveGitStatusAfterMutation: vi.fn(),
      refreshBranchCompareRef: { current: vi.fn() },
      refreshGitHistoryRef: { current: vi.fn() },
      setAdvanceOperationInFlightByWorktree,
      setRemoteActionErrors,
      worktreePath: '/repo',
      ...overrides
    })
  )
}

describe('useSourceControlConflictAdvance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('continues the running operation', async () => {
    const { result } = setup()

    await act(async () => {
      result.current.handleContinueOperation('rebase')
    })

    expect(runners.continueRebase).toHaveBeenCalledTimes(1)
  })

  it('routes each operation to its own runner', async () => {
    const merge = setup({ conflictOperation: 'merge' })
    await act(async () => {
      merge.result.current.handleContinueOperation('merge')
    })
    const cherry = setup({ conflictOperation: 'cherry-pick' })
    await act(async () => {
      cherry.result.current.handleContinueOperation('cherry-pick')
    })

    expect(runners.continueMerge).toHaveBeenCalledTimes(1)
    expect(runners.continueCherryPick).toHaveBeenCalledTimes(1)
    expect(runners.continueRebase).not.toHaveBeenCalled()
  })

  it('ignores a request for an operation that is no longer the one running', async () => {
    const { result } = setup({ conflictOperation: 'merge' })

    await act(async () => {
      result.current.handleContinueOperation('rebase')
    })

    expect(runners.continueRebase).not.toHaveBeenCalled()
  })

  it('refuses to advance while an abort is already in flight', async () => {
    const { result } = setup({ isAbortingOperation: true })

    await act(async () => {
      result.current.handleContinueOperation('rebase')
    })

    expect(runners.continueRebase).not.toHaveBeenCalled()
  })

  it('surfaces a failure and clears the in-flight flag', async () => {
    runners.continueRebase.mockRejectedValueOnce(new Error('needs merge'))
    const { result } = setup()

    await act(async () => {
      result.current.handleContinueOperation('rebase')
    })

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    // Set true on entry, false in the finally block — a stuck flag would disable the banner forever.
    expect(setAdvanceOperationInFlightByWorktree).toHaveBeenCalledTimes(2)
  })
})
