/**
 * A browser create from one paired device must select the tab on that device only. Before
 * `navigation`, `browser.tabCreate` carried no origin, so the host desktop and every other paired
 * client jumped to a tab someone else opened.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../shared/runtime-types'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { OrcaRuntimeService } from './orca-runtime'
import { setRuntimeBrowserCommandsFactory } from './runtime-browser-commands-factory'

const { browserSessionRegistryMock } = vi.hoisted(() => ({
  browserSessionRegistryMock: {
    getDefaultProfile: () => ({ id: 'default', partition: 'persist:orca-browser' }),
    getProfile: () => ({ id: 'default', partition: 'persist:orca-browser' }),
    resolveKnownPartition: () => 'persist:orca-browser'
  }
}))

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), removeListener: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
  webContents: { fromId: vi.fn() }
}))
vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: browserSessionRegistryMock
}))

const WT = 'repo-1::/tmp/worktree-a'

const storeBase = {
  getRepo: () => ({
    id: 'repo-1',
    path: '/tmp/repo',
    displayName: 'repo',
    badgeColor: 'blue',
    addedAt: 1
  }),
  getRepos: () => [storeBase.getRepo()],
  addRepo: () => {},
  updateRepo: () => undefined as never,
  getAllWorktreeMeta: () => ({}),
  getWorktreeMeta: () => undefined,
  getGitHubCache: () => ({ pr: {}, issue: {} }),
  setWorktreeMeta: () => undefined as never,
  removeWorktreeMeta: () => {},
  getRetiredWorktreeNameRegistry: () => ({ exhaustedTiers: 0, names: [] }),
  addRetiredWorktreeName: () => {},
  mergeRetiredWorktreeNames: () => false,
  getSettings: () => ({
    workspaceDir: '/tmp/workspaces',
    nestWorkspaces: false,
    refreshLocalBaseRefOnWorktreeCreate: false,
    branchPrefix: 'none',
    branchPrefixCustom: ''
  })
}

type RuntimeInternals = {
  offscreenBrowserBackend: unknown
  agentBrowserBridge: unknown
  resolveWorktreeSelector: (selector: string) => Promise<{ id: string }>
}

function makeSession(): WorkspaceSessionState {
  return {
    activeRepoId: 'repo-1',
    activeWorktreeId: WT,
    activeTabId: null,
    tabsByWorktree: {
      [WT]: [
        {
          id: 'terminal-tab',
          ptyId: 'repo-1::wt@@abc',
          worktreeId: WT,
          title: 'Terminal',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    terminalLayoutsByTabId: {}
  }
}

/** A runtime whose headless snapshot already carries one browser page, plus two paired devices. */
function createPairedRuntime() {
  let session = makeSession()
  const runtime = new OrcaRuntimeService({
    ...storeBase,
    getWorkspaceSession: () => session,
    setWorkspaceSession: (next: WorkspaceSessionState) => {
      session = next
    }
  })
  const internals = runtime as unknown as RuntimeInternals
  // Why stubbed: selector resolution scans real git worktrees, and none of this test's behavior
  // lives there — the browser command only needs the worktree id it hands the snapshot.
  internals.resolveWorktreeSelector = async () => ({ id: WT })
  internals.offscreenBrowserBackend = {
    closeTab: vi.fn(),
    createTab: vi.fn(async (options: { browserPageId?: string }) => ({
      browserPageId: options.browserPageId ?? 'page-new'
    }))
  }
  internals.agentBrowserBridge = {
    tabList: vi.fn(() => ({
      tabs: [
        { browserPageId: 'page-old', index: 0, url: 'https://old.test', title: 'Old', active: true },
        { browserPageId: 'page-new', index: 1, url: 'about:blank', title: 'New', active: false }
      ]
    })),
    getRegisteredTabs: vi.fn(() => new Map()),
    setActiveTab: vi.fn()
  }
  const caller: RuntimeMobileSessionTabsResult[] = []
  runtime.onMobileSessionTabsChanged((snapshot) => caller.push(snapshot), 'device-caller')
  // Why this view and not a second paired listener: a paired client projects its OWN selection over
  // activeTabId and never followed the shared value, so a bystander socket cannot observe the steal.
  // The shared snapshot is what the host desktop's derived rows read — it is the surface that moved.
  const sharedActiveTabId = (): string | null | undefined =>
    (
      runtime as unknown as {
        getMobileSessionTabsForWorktree: (id: string) => RuntimeMobileSessionTabsResult
      }
    ).getMobileSessionTabsForWorktree(WT).activeTabId
  return { runtime, caller, sharedActiveTabId }
}

/**
 * Put the shared snapshot on a tab before the caller creates another one. Without this the shared
 * activeTabId starts null and "did not move" would pass against nothing.
 */
async function seedSharedSelection(runtime: OrcaRuntimeService): Promise<void> {
  await runtime.browserTabCreate({ worktree: `id:${WT}`, page: 'page-old', activate: true })
}

function createBrowserTab(
  runtime: OrcaRuntimeService,
  params: { navigation?: 'caller' | 'all' } = {}
): Promise<{ browserPageId: string }> {
  return runtime.browserTabCreate(
    {
      worktree: `id:${WT}`,
      page: 'page-new',
      url: 'about:blank',
      activate: true,
      ...(params.navigation ? { navigation: params.navigation } : {})
    },
    { pairedDeviceId: 'device-caller', clientKind: 'runtime' }
  )
}

describe('browser.tabCreate caller navigation', () => {
  beforeAll(async () => {
    // Why: constructing the browser commands is what pulls the Chromium cluster in, so production
    // installs this at the Electron entry and a Node host leaves the RPCs rejecting.
    const { RuntimeBrowserCommands } = await import('./orca-runtime-browser')
    setRuntimeBrowserCommandsFactory((host) => new RuntimeBrowserCommands(host))
    return () => setRuntimeBrowserCommandsFactory(null)
  })

  beforeEach(() => {
    vi.useFakeTimers()
    return () => vi.useRealTimers()
  })

  it('selects the new tab for the originating device only', async () => {
    const { runtime, caller, sharedActiveTabId } = createPairedRuntime()
    // Presence precondition: the shared view has a different tab selected to begin with, so
    // "did not move" below cannot pass by there being nothing selected either way.
    await seedSharedSelection(runtime)
    expect(sharedActiveTabId()).toBe('page-old')

    await createBrowserTab(runtime, { navigation: 'caller' })
    vi.advanceTimersByTime(300)

    // The reported defect: the server's own UI switched to the tab the client created.
    expect(sharedActiveTabId()).toBe('page-old')
    expect(caller.at(-1)?.activeTabId).toBe('page-new')
  })

  it('defaults an origin-less paired create to caller-local selection', async () => {
    const { runtime, caller, sharedActiveTabId } = createPairedRuntime()
    await seedSharedSelection(runtime)

    // An older client cannot send `navigation`; clientKind is what keeps its create local.
    await createBrowserTab(runtime)
    vi.advanceTimersByTime(300)

    expect(sharedActiveTabId()).toBe('page-old')
    expect(caller.at(-1)?.activeTabId).toBe('page-new')
  })

  it('still lets an explicit all-device create steer every screen', async () => {
    const { runtime, caller, sharedActiveTabId } = createPairedRuntime()
    await seedSharedSelection(runtime)

    await createBrowserTab(runtime, { navigation: 'all' })
    vi.advanceTimersByTime(300)

    expect(caller.at(-1)?.activeTabId).toBe('page-new')
    expect(sharedActiveTabId()).toBe('page-new')
  })

  it('leaves a background create unselected on every device', async () => {
    const { runtime, caller, sharedActiveTabId } = createPairedRuntime()
    await seedSharedSelection(runtime)

    await runtime.browserTabCreate(
      { worktree: `id:${WT}`, page: 'page-new', url: 'about:blank', navigation: 'caller' },
      { pairedDeviceId: 'device-caller', clientKind: 'runtime' }
    )
    vi.advanceTimersByTime(300)

    expect(caller.at(-1)?.activeTabId).not.toBe('page-new')
    expect(sharedActiveTabId()).toBe('page-old')
  })
})
