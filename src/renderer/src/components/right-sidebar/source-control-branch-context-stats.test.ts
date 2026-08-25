import { describe, expect, it } from 'vitest'
import {
  buildSourceControlUpstreamDivergenceStats,
  formatSourceControlRefLabel,
  resolveSourceControlDisplayedBaseRef,
  shouldShowSourceControlBranchContextChrome,
  shouldShowSourceControlBranchContextRow
} from './source-control/panel/branch-context-stats'
import type { GitBranchCompareSummary } from '../../../../shared/git-diff-compare-types'

const readySummary: GitBranchCompareSummary = {
  baseRef: 'origin/main',
  baseOid: 'base',
  compareRef: 'feature',
  headOid: 'head',
  mergeBase: 'base',
  changedFiles: 2,
  commitsAhead: 3,
  status: 'ready'
}

describe('source-control branch context stats', () => {
  it('prefers the compare summary base ref, then the configured compare base ref', () => {
    expect(resolveSourceControlDisplayedBaseRef(readySummary, 'origin/master')).toBe('origin/main')
    expect(resolveSourceControlDisplayedBaseRef(null, 'refs/remotes/origin/main')).toBe(
      'refs/remotes/origin/main'
    )
    expect(resolveSourceControlDisplayedBaseRef(null, null)).toBeNull()
  })

  it('formats refs for scannable labels without dropping remote qualification', () => {
    expect(formatSourceControlRefLabel('refs/remotes/origin/main')).toBe('origin/main')
    expect(formatSourceControlRefLabel('refs/heads/feature/foo')).toBe('feature/foo')
    expect(formatSourceControlRefLabel('origin/main')).toBe('origin/main')
    expect(formatSourceControlRefLabel('refs/tags/v1.2.3')).toBe('v1.2.3')
  })

  it('shows the row only when a displayable base ref exists', () => {
    expect(shouldShowSourceControlBranchContextRow(null, null)).toBe(false)
    expect(shouldShowSourceControlBranchContextRow(null, 'origin/main')).toBe(true)
    expect(
      shouldShowSourceControlBranchContextRow({ ...readySummary, status: 'loading' }, null)
    ).toBe(true)
    expect(shouldShowSourceControlBranchContextRow(readySummary, null)).toBe(true)
    // Summary without a usable base must not claim the row is visible.
    expect(shouldShowSourceControlBranchContextRow({ ...readySummary, baseRef: '   ' }, null)).toBe(
      false
    )
    expect(shouldShowSourceControlBranchContextRow({ ...readySummary, baseRef: '' }, null)).toBe(
      false
    )
  })

  it('shows toolbar chrome when head identity exists even without a base', () => {
    expect(shouldShowSourceControlBranchContextChrome(null, null, null)).toBe(false)
    expect(
      shouldShowSourceControlBranchContextChrome(null, null, {
        kind: 'branch',
        branchName: 'local-only'
      })
    ).toBe(true)
    expect(shouldShowSourceControlBranchContextChrome(readySummary, null, null)).toBe(true)
  })

  it('renders ahead and behind counts against the tracking branch', () => {
    const stats = buildSourceControlUpstreamDivergenceStats({
      hasUpstream: true,
      upstreamName: 'origin/feature',
      ahead: 2,
      behind: 1
    })
    expect(stats.map((stat) => stat.label)).toEqual(['↑2', '↓1'])
    expect(stats[0]?.title).toBe('2 commits ahead of origin/feature')
    expect(stats[1]?.title).toBe('1 commit behind origin/feature')
  })

  // The rebase case: upstream still points at the pre-rebase branch while the
  // compare base is origin/main. Only the upstream counts belong here, so there
  // is nothing for the base ref to be confused with.
  it('never reports the branch against its compare base', () => {
    const stats = buildSourceControlUpstreamDivergenceStats({
      hasUpstream: true,
      upstreamName: 'origin/feature',
      ahead: 25,
      behind: 5
    })
    expect(stats.map((stat) => stat.label)).toEqual(['↑25', '↓5'])
    expect(stats.every((stat) => stat.title.includes('origin/feature'))).toBe(true)
    expect(stats.some((stat) => stat.title.includes('origin/main'))).toBe(false)
  })

  it('reports nothing without a tracking branch', () => {
    expect(buildSourceControlUpstreamDivergenceStats(undefined)).toEqual([])
    expect(
      buildSourceControlUpstreamDivergenceStats({ hasUpstream: false, ahead: 0, behind: 0 })
    ).toEqual([])
  })

  it('falls back to a generic upstream label when upstreamName is missing', () => {
    const stats = buildSourceControlUpstreamDivergenceStats({
      hasUpstream: true,
      ahead: 2,
      behind: 0
    })
    expect(stats[0]?.title).toBe('2 commits ahead of upstream')
  })

  it('returns no stats when the branch is even with its upstream', () => {
    expect(
      buildSourceControlUpstreamDivergenceStats({ hasUpstream: true, ahead: 0, behind: 0 })
    ).toEqual([])
  })
})
