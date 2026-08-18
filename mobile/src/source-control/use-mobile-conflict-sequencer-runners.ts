import { useCallback } from 'react'

// RPC method per conflict-banner control, keyed by the in-progress git operation.
const ABORT_METHODS: Record<string, string | undefined> = {
  merge: 'git.abortMerge',
  rebase: 'git.abortRebase'
}

const CONTINUE_METHODS: Record<string, string | undefined> = {
  merge: 'git.continueMerge',
  rebase: 'git.continueRebase',
  'cherry-pick': 'git.continueCherryPick'
}

type RunGitAction = (
  actionId: string,
  method: string,
  params: Record<string, unknown>
) => Promise<void>

/** Abort / Continue controls on the conflict banner. */
export function useMobileConflictSequencerRunners(runGitAction: RunGitAction) {
  const runForOperation = useCallback(
    async (prefix: string, methods: Record<string, string | undefined>, operation: string) => {
      const method = methods[operation]
      if (!method) {
        return
      }
      await runGitAction(`${prefix}-${operation}`, method, {})
    },
    [runGitAction]
  )

  return {
    abortConflictOperation: useCallback(
      (operation: string) => runForOperation('abort', ABORT_METHODS, operation),
      [runForOperation]
    ),
    continueConflictOperation: useCallback(
      (operation: string) => runForOperation('continue', CONTINUE_METHODS, operation),
      [runForOperation]
    )
  }
}
