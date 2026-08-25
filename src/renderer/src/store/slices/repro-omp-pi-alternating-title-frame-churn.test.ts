/**
 * OMP tab-title churn repro: an OMP-owned terminal tab's title text oscillates
 * between "OMP" and "Pi" at spinner cadence, committing a fresh store patch on
 * every frame.
 *
 * Both of those strings are manufactured by Orca. OMP emits NEITHER.
 * Verified against oh-my-pi/packages/coding-agent/src/utils/title-generator.ts:
 * `DEFAULT_TERMINAL_TITLE = "π"` (:25) and `buildTerminalTitleWithState` (:530-544)
 * compose `π ⠋ <label>` / `π > <label>` / `π ! <label>` — always the π glyph,
 * never the ASCII "Pi", never "OMP". And on an Orca-hosted pane OMP's native
 * titler cedes entirely: Orca injects its own extension
 * (src/main/pi/titlebar-extension-source.ts:21,44) which writes
 * `π - <session> - <cwd>` and `⠋ π - <session> - <cwd>` every 80ms.
 *
 * The two strings that actually reach this store come from two OTHER Orca parts:
 *
 *  A) `driveSyntheticTitleFromHook` (src/main/index.ts) injects
 *     `\x1b]0;<frame> <profile.workingLabel>\x07` every 80ms. For an OMP-owned
 *     pane `SYNTHETIC_AGENT_TITLE_PROFILES.omp.workingLabel` is "OMP", so every
 *     tick asserts "<spinner> OMP".
 *  B) `normalizeTerminalTitle` (src/shared/agent-title-status.ts:135-144) takes
 *     the extension's own `⠋ π - session - cwd` and collapses it to the HARDCODED
 *     literal "⠋ Pi" — discarding identity, session and cwd. That destroyed label
 *     is issue #16093.
 *
 * So the flap is Orca mangling its own extension's output and then fighting the
 * result with a third writer of its own. The fixtures below are post-normalization
 * store values, not wire frames.
 *
 * `pi` and `omp` share `titleIdentityGroup: 'pi-compatible'`
 * (src/shared/synthetic-agent-title.ts), so to a pane these are the SAME agent.
 *
 * The churn suppressor that normally absorbs spinner noise was defeated here.
 * `isDecorativeAgentTitleFrameChange` keys on `status:textWithoutSpinner`
 * (src/shared/agent-decorative-title-signature.ts): "⠋ OMP" -> `working:OMP`,
 * "⠙ Pi" -> `working:Pi`. Different signatures, so every alternating frame was
 * classified as MEANINGFUL and committed — through `applyTerminalTabTitleUpdates`
 * for `tab.title` and `setRuntimePaneTitle` for the pane slot. At 80ms that is
 * ~12 committed patches per second per working OMP tab, with a visible flicker.
 *
 * This suite pins the INTERIM mitigation: collapse the identity group inside the
 * signature so the two Orca-made labels compare equal and neither commits.
 * Deliberately NOT a rewrite of the stored title — `runtimePaneTitlesByTabId` is
 * also the Windows Shift+Enter byte-encoding input (keyboard-handlers.ts ->
 * terminal-windows-shift-enter.ts), so normalizing at ingest destroys evidence
 * other consumers read (that was #16373, reverted here, and it cost us #16376).
 *
 * It does NOT restore the label `normalizeTerminalTitle` already destroyed; that
 * needs the collapse itself fixed, which is tracked separately.
 *
 * The oracle is commit COUNT plus byte-identity of what does land.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({
  scheduleRuntimeGraphSync: vi.fn()
}))
vi.mock('@/components/terminal-pane/pty-transport', () => ({
  registerEagerPtyBuffer: vi.fn(),
  ensurePtyDispatcher: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))
vi.mock('@/components/terminal-pane/shutdown-buffer-captures', () => ({
  shutdownBufferCaptures: vi.fn()
}))

// @ts-expect-error -- minimal preload API stub for the slice's IPC writes
globalThis.window = { api: {} }

import { getPiCompatibleSyntheticAgentLabel } from '../../../../shared/pi-compatible-synthetic-title'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import {
  createTestStore,
  makeTab,
  makeUnifiedTab,
  makeWorktree,
  seedStore
} from './store-test-helpers'

const WT = 'wt-omp'
const TAB_ID = 'tab-omp-1'
const GROUP_ID = 'group-1'
const PANE_ID = 1

// Verbatim from src/main/index.ts:1947.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * 20 frames of one OMP turn: main's synthetic "OMP" tick interleaved with the
 * wrapped Pi harness's own frame. Every frame classifies as 'working', so the
 * ONLY thing changing is which of the two pi-compatible identities is showing.
 */
const OMP_TURN_TITLE_FRAMES = Array.from({ length: 20 }, (_, index) => {
  const spinner = SPINNER_FRAMES[index % SPINNER_FRAMES.length]
  return index % 2 === 0 ? `${spinner} OMP` : `${spinner} Pi`
})

function seedOmpTab(store: ReturnType<typeof createTestStore>): void {
  seedStore(store, {
    worktreesByRepo: {
      repo1: [makeWorktree({ id: WT, repoId: 'repo1', path: '/path/wt-omp' })]
    },
    tabsByWorktree: {
      // The user launched OMP into this tab — the identity the title must follow.
      [WT]: [makeTab({ id: TAB_ID, worktreeId: WT, title: 'Terminal 1', launchAgent: 'omp' })]
    },
    unifiedTabsByWorktree: {
      [WT]: [makeUnifiedTab({ id: TAB_ID, worktreeId: WT, groupId: GROUP_ID })]
    },
    activeWorktreeId: WT
  })
}

/** The identity a tab-bar frame reads as: 'OMP', 'Pi', or null when neither. */
function displayedAgentIdentity(tabTitle: string): string | null {
  return getPiCompatibleSyntheticAgentLabel(
    resolveTerminalTabTitle({ title: tabTitle, customTitle: null }, false, 'Terminal 1')
  )
}

describe('OMP-owned tab title across interleaved OMP/Pi spinner frames', () => {
  it('commits at most one tab-title patch for the whole working turn', () => {
    const store = createTestStore()
    seedOmpTab(store)

    // Zustand only notifies when the action returns a fresh patch, so one
    // listener call === one committed store patch.
    let commits = 0
    const seenTitles: string[] = []
    const unsubscribe = store.subscribe((state) => {
      commits += 1
      const title = state.tabsByWorktree[WT]?.[0]?.title
      if (title && title !== seenTitles.at(-1)) {
        seenTitles.push(title)
      }
    })

    for (const frame of OMP_TURN_TITLE_FRAMES) {
      store.getState().updateTabTitle(TAB_ID, frame)
    }
    unsubscribe()

    // One commit takes the tab off its "Terminal 1" default; the remaining 19
    // frames are pure decoration under the OMP owner.
    expect(commits).toBeLessThanOrEqual(1)
    expect(Array.from(new Set(seenTitles.map(displayedAgentIdentity)))).toEqual(['OMP'])
  })

  it('commits at most one runtime pane-title patch for the whole working turn', () => {
    const store = createTestStore()
    seedOmpTab(store)

    let commits = 0
    const unsubscribe = store.subscribe(() => {
      commits += 1
    })

    for (const frame of OMP_TURN_TITLE_FRAMES) {
      store.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, frame)
    }
    unsubscribe()

    expect(commits).toBeLessThanOrEqual(1)
    expect(
      getPiCompatibleSyntheticAgentLabel(
        store.getState().runtimePaneTitlesByTabId[TAB_ID]?.[PANE_ID] ?? ''
      )
    ).toBe('OMP')
  })

  // Why: the fix must never rewrite what a frame says — `runtimePaneTitlesByTabId` feeds the
  // Windows Shift+Enter encoding, so a normalized title there silently changes keyboard bytes.
  it('stores every committed frame byte-for-byte, never a relabeled form', () => {
    const store = createTestStore()
    seedOmpTab(store)

    for (const frame of ['⠋ Pi', '⠋ OMP']) {
      const fresh = createTestStore()
      seedOmpTab(fresh)
      fresh.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, frame)
      expect(fresh.getState().runtimePaneTitlesByTabId[TAB_ID]?.[PANE_ID]).toBe(frame)
      fresh.getState().updateTabTitle(TAB_ID, frame)
      expect(fresh.getState().tabsByWorktree[WT]?.[0]?.title).toBe(frame)
    }
    void store
  })

  // Why: a multiplexer prefixes the pane's own title, so the identity sits mid-string. Anchored
  // matching missed it and the flap survived under tmux/Zellij (#8032).
  it('suppresses the flap under a multiplexer prefix', () => {
    const store = createTestStore()
    seedOmpTab(store)

    let commits = 0
    const unsubscribe = store.subscribe(() => {
      commits += 1
    })
    for (let index = 0; index < 20; index += 1) {
      const spinner = SPINNER_FRAMES[index % SPINNER_FRAMES.length]
      store
        .getState()
        .setRuntimePaneTitle(TAB_ID, PANE_ID, `zsh | ${spinner} ${index % 2 === 0 ? 'OMP' : 'Pi'}`)
    }
    unsubscribe()

    expect(commits).toBeLessThanOrEqual(1)
  })

  // Why: collapsing identity must not collapse STATE — a real working->idle transition still commits.
  it('still commits a genuine status change', () => {
    const store = createTestStore()
    seedOmpTab(store)

    store.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, '⠋ OMP')
    let commits = 0
    const unsubscribe = store.subscribe(() => {
      commits += 1
    })
    store.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, 'OMP ready')
    unsubscribe()

    expect(commits).toBe(1)
    expect(store.getState().runtimePaneTitlesByTabId[TAB_ID]?.[PANE_ID]).toBe('OMP ready')
  })

  // Why: a different agent taking the pane is a real identity change, not group decoration.
  it('still commits a cross-group identity change', () => {
    const store = createTestStore()
    seedOmpTab(store)

    store.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, '⠋ OMP')
    let commits = 0
    const unsubscribe = store.subscribe(() => {
      commits += 1
    })
    store.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, '⠙ Codex')
    unsubscribe()

    expect(commits).toBe(1)
    expect(store.getState().runtimePaneTitlesByTabId[TAB_ID]?.[PANE_ID]).toBe('⠙ Codex')
  })

  // Why: a legacy "π - <session> - <cwd>" frame is Pi-compatible too, but its text is real session
  // state. Folding it into the group token would make two different sessions compare equal and
  // suppress the change outright — the #16093 complaint, reintroduced through the signature.
  it('still commits a change between two semantic session titles', () => {
    const store = createTestStore()
    seedOmpTab(store)

    store.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, 'π - fixing the sidebar - orca')
    let commits = 0
    const unsubscribe = store.subscribe(() => {
      commits += 1
    })
    store.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, 'π - writing the tests - orca')
    unsubscribe()

    expect(commits).toBe(1)
    expect(store.getState().runtimePaneTitlesByTabId[TAB_ID]?.[PANE_ID]).toBe(
      'π - writing the tests - orca'
    )
  })

  // Why: owner-pinning must stay scoped to bare identity frames. A semantic session title carries
  // text no agent profile can reproduce, so relabeling it to "OMP ready" would lose real
  // information — the complaint in #16093, which this fix must not reintroduce.
  it('leaves a semantic session title untouched', () => {
    const store = createTestStore()
    seedOmpTab(store)

    const semanticTitle = 'π - fixing the sidebar - orca'
    store.getState().updateTabTitle(TAB_ID, semanticTitle)
    store.getState().setRuntimePaneTitle(TAB_ID, PANE_ID, semanticTitle)

    expect(store.getState().tabsByWorktree[WT]?.[0]?.title).toBe(semanticTitle)
    expect(store.getState().runtimePaneTitlesByTabId[TAB_ID]?.[PANE_ID]).toBe(semanticTitle)
  })
})
