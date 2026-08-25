import type { GitBranchCompareSummary } from '../../../../../../shared/git-diff-compare-types'
import type { GitUpstreamStatus } from '../../../../../../shared/git-status-types'
import type { WorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import { translate } from '@/i18n/i18n'

function formatAheadOfTitle(count: number, ref: string): string {
  return count === 1
    ? translate(
        'auto.components.right.sidebar.SourceControl.f9b2441bb6',
        '1 commit ahead of {{value0}}',
        { value0: ref }
      )
    : translate(
        'auto.components.right.sidebar.SourceControl.b715ef615b',
        '{{value0}} commits ahead of {{value1}}',
        { value0: count, value1: ref }
      )
}

function formatBehindOfTitle(count: number, ref: string): string {
  return count === 1
    ? translate(
        'auto.components.right.sidebar.SourceControl.c1a8f3e204',
        '1 commit behind {{value0}}',
        { value0: ref }
      )
    : translate(
        'auto.components.right.sidebar.SourceControl.d2b9g4f315',
        '{{value0}} commits behind {{value1}}',
        { value0: count, value1: ref }
      )
}

// Why: ahead/behind carry no color of their own. Green and red are reserved for
// the line-total chip that sits beside them — an `↑1` in added-green next to
// `+1,114` reads as one quantity when they count different things (commits vs
// lines). The ↑/↓ glyph already carries direction.
export type SourceControlBranchContextStat = {
  key: string
  label: string
  title: string
}

export function resolveSourceControlDisplayedBaseRef(
  summary: GitBranchCompareSummary | null | undefined,
  compareBaseRef: string | null | undefined
): string | null {
  const summaryRef = summary?.baseRef?.trim()
  if (summaryRef) {
    return summaryRef
  }
  const configuredRef = compareBaseRef?.trim()
  return configuredRef || null
}

// Why: context-row labels should stay scannable — drop git namespace prefixes
// but keep remote qualification (origin/main) so multi-remote bases stay distinct.
export function formatSourceControlRefLabel(ref: string): string {
  return ref
    .trim()
    .replace(/^refs\/remotes\//, '')
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/tags\//, '')
}

// Why: the compare row needs a displayable base; a summary alone with an empty
// baseRef would still fail the component's displayedBaseRef guard.
export function shouldShowSourceControlBranchContextRow(
  summary: GitBranchCompareSummary | null | undefined,
  compareBaseRef: string | null | undefined
): boolean {
  return resolveSourceControlDisplayedBaseRef(summary, compareBaseRef) != null
}

// Why: head-only identity still mounts when there is no base, so toolbar chrome
// visibility is "base OR head" — not base alone.
export function shouldShowSourceControlBranchContextChrome(
  summary: GitBranchCompareSummary | null | undefined,
  compareBaseRef: string | null | undefined,
  headDisplay: WorktreeGitIdentityDisplay | null | undefined
): boolean {
  return shouldShowSourceControlBranchContextRow(summary, compareBaseRef) || headDisplay != null
}

function resolveUpstreamDisplayLabel(upstreamStatus: GitUpstreamStatus): string {
  const named = upstreamStatus.upstreamName?.trim()
  if (named) {
    return formatSourceControlRefLabel(named)
  }
  return translate('auto.components.right.sidebar.SourceControl.f3a1b8c204', 'upstream')
}

// ↑/↓ mean one thing only: this branch against the branch it tracks — the same
// reading every other git UI gives them.
export function buildSourceControlUpstreamDivergenceStats(
  upstreamStatus: GitUpstreamStatus | undefined
): SourceControlBranchContextStat[] {
  if (!upstreamStatus?.hasUpstream) {
    return []
  }

  const ref = resolveUpstreamDisplayLabel(upstreamStatus)
  const stats: SourceControlBranchContextStat[] = []

  if (upstreamStatus.ahead > 0) {
    stats.push({
      key: 'upstream-ahead',
      label: `↑${upstreamStatus.ahead}`,
      title: formatAheadOfTitle(upstreamStatus.ahead, ref)
    })
  }
  if (upstreamStatus.behind > 0) {
    stats.push({
      key: 'upstream-behind',
      label: `↓${upstreamStatus.behind}`,
      title: formatBehindOfTitle(upstreamStatus.behind, ref)
    })
  }

  return stats
}
