import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runProcessMock } = vi.hoisted(() => ({ runProcessMock: vi.fn() }))

vi.mock('../shared/child-process/run-process', () => ({ runProcess: runProcessMock }))

import { createGitHandlerRelay } from './git-handler-test-harness'

const SEQUENCER_METHODS: readonly [string, string[]][] = [
  ['git.continueMerge', ['merge', '--continue']],
  ['git.continueRebase', ['rebase', '--continue']],
  ['git.continueCherryPick', ['cherry-pick', '--continue']],
  ['git.skipRebase', ['rebase', '--skip']],
  ['git.skipCherryPick', ['cherry-pick', '--skip']]
]

type GitTerminationTarget = {
  git(
    args: string[],
    cwd: string,
    options: { signal?: AbortSignal; terminationBarrier: true; timeout?: number }
  ): Promise<{ stdout: string; stderr: string }>
}

describe('GitHandler termination barrier', () => {
  beforeEach(() => runProcessMock.mockReset())

  it('rejects a zero-exit result that crossed its timeout', async () => {
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: true
    })
    const { handler } = createGitHandlerRelay()
    const target = handler as unknown as GitTerminationTarget

    await expect(
      target.git(['status'], '/repo', { terminationBarrier: true, timeout: 1 })
    ).rejects.toThrow('git status timed out.')
  })

  it('rejects a zero-exit result after caller cancellation', async () => {
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false
    })
    const controller = new AbortController()
    controller.abort()
    const { handler } = createGitHandlerRelay()
    const target = handler as unknown as GitTerminationTarget

    await expect(
      target.git(['status'], '/repo', {
        signal: controller.signal,
        terminationBarrier: true
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('GitHandler sequencer cancellation', () => {
  // Why braces: mockReset() returns the mock, and a beforeEach that RETURNS a
  // function makes Vitest call it as the teardown hook (with no arguments).
  beforeEach(() => {
    runProcessMock.mockReset()
  })

  it.each(SEQUENCER_METHODS)(
    '%s terminates the child before the handler settles when the request aborts',
    async (method, args) => {
      const controller = new AbortController()
      let childTerminated = false
      let spawned: () => void = () => {}
      const childSpawned = new Promise<void>((resolve) => {
        spawned = resolve
      })
      runProcessMock.mockImplementation(async () => {
        spawned()
        // Why: model a child that outlives the abort request; runProcess only
        // resolves once it has actually reaped it (terminationBarrier).
        await new Promise((resolve) => setTimeout(resolve, 10))
        childTerminated = true
        return { code: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: false }
      })

      const { dispatcher } = createGitHandlerRelay()
      const settled = dispatcher
        .callRequest(
          method,
          { worktreePath: '/repo' },
          { isStale: () => controller.signal.aborted, signal: controller.signal }
        )
        .then(
          () => ({ childTerminatedAtSettle: childTerminated, error: null as unknown }),
          (error: unknown) => ({ childTerminatedAtSettle: childTerminated, error })
        )

      await childSpawned
      controller.abort()
      const outcome = await settled

      expect(runProcessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          program: 'git',
          args,
          signal: controller.signal,
          terminationBarrier: true
        })
      )
      expect(outcome.childTerminatedAtSettle).toBe(true)
      expect(outcome.error).toMatchObject({ name: 'AbortError' })
    }
  )
})
