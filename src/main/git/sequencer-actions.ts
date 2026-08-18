import { editorSuppressedGitEnv } from '../../shared/git-sequencer-editor-env'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import { runWithGitReadCacheInvalidation } from './status'

// Why: every subcommand here predates the Git 2.25 baseline (`merge --continue` 2.12,
// the rest older), so no capability probe or fallback is needed.
async function runSequencerAction(
  args: readonly [string, string],
  worktreePath: string,
  options: GitRuntimeOptions
): Promise<void> {
  await runWithGitReadCacheInvalidation(() =>
    gitExecFileAsync([...args], {
      ...gitOptionsForWorktree(worktreePath, options),
      // Why: `--continue` opens the commit-message editor and would hang with no terminal to close it.
      env: editorSuppressedGitEnv()
    })
  )
}

export async function continueMerge(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  await runSequencerAction(['merge', '--continue'], worktreePath, options)
}

export async function continueRebase(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  await runSequencerAction(['rebase', '--continue'], worktreePath, options)
}

export async function continueCherryPick(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  await runSequencerAction(['cherry-pick', '--continue'], worktreePath, options)
}
