import { useCallback } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getConnectionId } from '@/lib/connection-context'
import {
  continueRuntimeGitCherryPick,
  continueRuntimeGitMerge,
  continueRuntimeGitRebase
} from '@/runtime/runtime-git-client'
import type { GitConflictOperation } from '../../../../../../shared/git-status-types'
import type { SourceControlWorktreeContext } from '../listing/use-worktree-context'
import type { SourceControlWorktreeOperationState } from '../panel/use-worktree-operation-state'
import { refreshSourceControlAfterRemoteAction } from './remote-refresh'
import type { SourceControlStatusRefresh } from './use-status-refresh'

const CONTINUE_RUNNERS = {
  merge: continueRuntimeGitMerge,
  rebase: continueRuntimeGitRebase,
  'cherry-pick': continueRuntimeGitCherryPick
} as const

/** Continue for an in-progress merge/rebase/cherry-pick: moves the sequencer forward. */
export function useSourceControlConflictAdvance({
  activeRepoSettings,
  activeWorktreeId,
  conflictOperation,
  isAdvancingOperation,
  isAbortingOperation,
  refreshActiveGitStatusAfterMutation,
  refreshBranchCompareRef,
  refreshGitHistoryRef,
  setAdvanceOperationInFlightByWorktree,
  setRemoteActionErrors,
  worktreePath
}: {
  activeRepoSettings: SourceControlWorktreeContext['activeRepoSettings']
  activeWorktreeId: string | null
  conflictOperation: GitConflictOperation
  isAdvancingOperation: boolean
  isAbortingOperation: boolean
  refreshActiveGitStatusAfterMutation: SourceControlStatusRefresh['refreshActiveGitStatusAfterMutation']
  refreshBranchCompareRef: React.RefObject<() => Promise<void>>
  refreshGitHistoryRef: React.RefObject<() => Promise<void>>
  setAdvanceOperationInFlightByWorktree: SourceControlWorktreeOperationState['setAdvanceOperationInFlightByWorktree']
  setRemoteActionErrors: SourceControlWorktreeOperationState['setRemoteActionErrors']
  worktreePath: string | null
}) {
  const runAdvance = useCallback(
    async (requestedOperation: GitConflictOperation): Promise<void> => {
      if (
        !activeWorktreeId ||
        !worktreePath ||
        conflictOperation !== requestedOperation ||
        isAdvancingOperation ||
        isAbortingOperation
      ) {
        return
      }
      const runner = CONTINUE_RUNNERS[requestedOperation as keyof typeof CONTINUE_RUNNERS]
      if (!runner) {
        return
      }

      const connectionId = getConnectionId(activeWorktreeId) ?? undefined
      setAdvanceOperationInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: true }))
      setRemoteActionErrors((prev) => ({ ...prev, [activeWorktreeId]: null }))
      try {
        await runner({
          // Why: route by the repo OWNER host, not the focused runtime.
          settings: activeRepoSettings,
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast.error(
          translate(
            'auto.components.right.sidebar.source.control.sync.use.conflict.advance.b84fcd7ea6',
            'Continue {{value0}} failed',
            { value0: requestedOperation }
          ),
          { description: message }
        )
        setRemoteActionErrors((prev) => ({
          ...prev,
          [activeWorktreeId]: {
            kind: 'continue_operation',
            message,
            rawError: message
          }
        }))
      } finally {
        setAdvanceOperationInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: false }))
        // Why: continue can land straight in a NEW conflict, so the banner must re-read status.
        refreshSourceControlAfterRemoteAction({
          refreshGitStatus: refreshActiveGitStatusAfterMutation,
          refreshBranchCompare: refreshBranchCompareRef.current,
          refreshGitHistory: refreshGitHistoryRef.current
        })
      }
    },
    [
      activeRepoSettings,
      activeWorktreeId,
      conflictOperation,
      isAbortingOperation,
      isAdvancingOperation,
      refreshActiveGitStatusAfterMutation,
      refreshBranchCompareRef,
      refreshGitHistoryRef,
      setAdvanceOperationInFlightByWorktree,
      setRemoteActionErrors,
      worktreePath
    ]
  )

  const handleContinueOperation = useCallback(
    (operation: GitConflictOperation): void => {
      void runAdvance(operation)
    },
    [runAdvance]
  )

  return { handleContinueOperation }
}

export type SourceControlConflictAdvance = ReturnType<typeof useSourceControlConflictAdvance>
