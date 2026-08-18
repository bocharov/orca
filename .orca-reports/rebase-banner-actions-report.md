# Rebase/merge banner — remaining scope, completed

All three items implemented, uncommitted in `rebase-banner-actions`. 56 files modified, 21 new.
The pre-existing work (Resolve with AI on OperationBanner, `canSendConflictsToAgent`) was kept intact.

## 1. Branch identity while an operation runs

The header read `Detached HEAD · 285883d → origin/main ↑1` mid-rebase. Now it names the branch.

- `src/renderer/src/lib/worktree-git-identity-display.ts` — new `getWorktreeGitOperationIdentityDisplay()`
  and an `operation` variant on `WorktreeGitIdentityDisplay`. Kept as structured data (branchName,
  operation, shortHead, head) so labels stay translatable at the render site. The eight existing
  callers of the plain function are untouched.
- `panel/head-identity-chip.tsx` (new) — extracted `HeadIdentity` + `resolveHeadFlowLabel` out of
  `branch-context-row.tsx`, which was at ~395 of its 400-line budget. Renders `triage-e2e · rebasing`
  with the qualifier in amber; the raw SHA moved into the tooltip.
- `panel/branch-context-stats.ts` — `buildSourceControlBranchContextStats` takes
  `operationInProgress` and returns `[]`. `conflictOperation` is threaded
  panel-ready → header-toolbar → branch-context-row. The base ref itself still shows; only the
  counts measured against a transient mid-rebase commit go away.

## 2. Step meter and commit subject

- `src/shared/git-status-types.ts` — `GitOperationProgress` (headName, onto, currentStep,
  totalSteps, commitSubject, stoppedBy) as one optional field on `GitStatusResult`.
  Additive optional field = Rule 1 of remote-wire-compatibility. Absent means unknown throughout;
  nothing is ever defaulted to 0.
- `src/shared/git-rebase-progress.ts` (new) — one reader used by BOTH producers
  (`src/main/git/status.ts` and `src/relay/git-handler-status-ops.ts`), which previously had
  duplicated `resolveGitDir`/`detectConflictOperation`. The relay executes on the remote host, so
  plain fs reads work for SSH — no new RPC. Read runs concurrently with the status stream.
- Formats verified against real repos on git 2.52 before coding:
  - `rebase-merge/`: msgnum, end, head-name, onto, message (first line), done (last line).
  - `rebase-apply/` (am mode): next, last, head-name, onto, final-commit. No done file, no edit/break.
  - `done` last-line command word distinguishes edit / break / pick — both the newer
    `pick <sha> # subject` and the older no-`#` form parse.
- Store: `gitOperationProgressByWorktree` slice, pruned on worktree removal/purge/rename.
  A capped ("too many changes") snapshot never reads the state dir, so it keeps the last known
  progress instead of blanking a live meter.

## 3. Continue and Skip

Five new RPCs mirroring abortMerge/abortRebase end to end: `git.continueMerge`,
`git.continueRebase`, `git.continueCherryPick`, `git.skipRebase`, `git.skipCherryPick`.
Chain: runtime-git-client → runtime-rpc allowlist + rpc/methods/git → git-provider-contract →
`src/main/git/sequencer-actions.ts` (new; NOT added to status.ts, which is at its line budget) →
ssh-git-provider → relay/git-handler → orca-runtime-git + orca-runtime → preload (api + index) →
main/ipc/filesystem → web-preload-api → mobile runners.

### The find worth knowing about
`git rebase|merge|cherry-pick --continue` **opens the user's commit-message editor**. With a normal
`core.editor=vim` the subprocess hangs forever. Verified on git 2.52:
- unset editor + hostile GIT_EDITOR → hangs;
- `git -c core.editor=true rebase --continue` → **still hangs** (the GIT_EDITOR env var beats
  `-c core.editor`);
- `GIT_EDITOR=true git rebase --continue` → completes.
Nothing in the codebase set GIT_EDITOR; `nonInteractiveGitEnv` guards credential prompts only.
`src/shared/git-sequencer-editor-env.ts` (new) sets it, and forwards it via WSLENV on win32 because
spawn env does not cross the wsl.exe boundary. The relay's private `git()` gained a
`suppressEditor` opt for the same reason (an SSH host can export its own GIT_EDITOR).
Guarded by unit tests on argv+env and by relay integration tests that drive real git through a
conflicted rebase/merge with a hostile `GIT_EDITOR=false` — those were confirmed to fail without
the fix.

Git versions checked against the 2.25 baseline: `merge --continue` 2.12, `cherry-pick --skip` 2.22,
the rest older. All at or below baseline, so no GitCapabilityCache probe and no fallback — recorded
in a comment so it is not re-litigated.

### UI
- `listing/operation-stop-reason.ts` (new) — pure derivation of why git stopped and which action leads.
- `listing/operation-progress-meter.tsx` (new), `listing/operation-banner-actions.tsx` (new).
- Layout per the mockup: one full-width primary, then Resolve with AI, then a quiet ghost footer row
  pairing Skip and Abort. Not four stacked full-width buttons.
- Primary by stop reason: conflicts → Resolve with AI; ready → Continue; empty patch → Skip;
  edit/break pause → Continue. Falls back to the next *offered* action when the preferred one has no
  handler.
- Continue needs no confirmation. Skip confirms (destructive), because it drops a commit.
- Both disabled while `isAbortingOperation` **or** `isAdvancingOperation` is true.
- `use-conflict-advance.ts` (new) mirrors `use-conflict-abort.ts`; refreshes status afterwards
  because Continue can land straight in a new conflict.

### Mid-flight transition
`ConflictSummaryCard` and `OperationBanner` were split into `OperationCardShell` + body components.
`content-status.tsx` renders one shell and swaps only the body, so the card box stays the same DOM
node across the swap. Asserted directly: the test holds the node reference and checks identity after
rerender. My first attempt kept two sibling components and the node *was* replaced — the test caught
it, and the shell was made genuinely stable rather than the assertion weakened.

## Two real bugs the tests caught in my own work
- Continue rendered `variant="default"` even when it was not the primary action, producing two
  competing default buttons. Fixed so only the primary slot reads as default.
- Continue was offered while conflicts were unresolved, where `git --continue` is guaranteed to fail
  ("You must edit all merge conflicts"). It is now withheld entirely in that state, matching the
  mockup; Skip is promoted when AI is unavailable.

## Verification (actual output)
- `npx tsc --noEmit -p config/tsconfig.tc.web.json` → exit 0
- `npx tsc --noEmit -p config/tsconfig.node.json` → exit 0
- `npx oxlint src mobile config tests` → exit 0
- `pnpm run check:max-lines-ratchet` → OK, no new bypasses
- `npx oxfmt --check` on all changed files → all correctly formatted
- localization catalog + coverage → exit 0 (18 new keys added via `pnpm run sync:localization-catalog`)
- renderer/shared/preload/store/runtime: **1099 files, 10 683 tests passed**
- main/relay: **1031 files, 11 570 tests passed**

### Two things that do NOT pass, both pre-existing and unrelated
1. `src/main/pty/posix-pty-process-groups.integration.test.ts` — `spawnSync ps ENOBUFS`.
   Confirmed pre-existing: it fails identically with all of my work stashed.
2. `mobile/` vitest cannot load any test file — `failed to resolve "extends":"expo/tsconfig.base.json"`.
   `mobile/node_modules` does not exist in this worktree and expo is not installed at the root;
   `mobile/tsconfig.json` is untouched by this change. Mobile files are covered by oxlint and by the
   node tsc project, both clean, but the mobile suite itself could not be executed here.

## Notes
- Not committed, not pushed, no PR.
- `rebase-banner-mockup.html` deleted (the brief left the choice; the design is now in code and tests).
