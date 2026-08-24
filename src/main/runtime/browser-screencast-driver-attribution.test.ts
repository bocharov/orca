/**
 * `browser.screencast` is the one stream a phone, a paired desktop client, the web client and the
 * CLI all open against the same host page. Stamping every subscriber as the mobile driver put the
 * host renderer's "Mobile is driving this browser" overlay — and its input lock — over a pane that
 * no phone had ever touched.
 */
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { RpcDispatcher } from './rpc/dispatcher'
import { BROWSER_SCREENCAST_METHODS } from './rpc/methods/browser-screencast'
import type { RuntimeBrowserDriverState } from '../../shared/runtime-types'

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), removeListener: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
  webContents: { fromId: vi.fn() }
}))

const WT = 'repo-1::/tmp/worktree-a'
const PAGE = 'page-1'

const store = {
  getRepo: () => ({
    id: 'repo-1',
    path: '/tmp/repo',
    displayName: 'repo',
    badgeColor: 'blue',
    addedAt: 1
  }),
  getRepos: () => [store.getRepo()],
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

type Session = { stop: () => void; done: Promise<void>; stops: () => number }

type Subscriber = {
  done: Promise<void>
  stop: () => void
  stops: () => number
  streaming: () => Promise<void>
}

/**
 * A runtime whose Chromium-facing screencast is replaced by a fake session per subscriber, so the
 * test drives the driver-attribution state machine without a browser.
 */
function createRuntime(): {
  runtime: OrcaRuntimeService
  subscribe: (options: { connectionId: string; clientKind?: 'mobile' | 'runtime' }) => Subscriber
  driver: () => RuntimeBrowserDriverState | undefined
} {
  const runtime = new OrcaRuntimeService(store as unknown as never)
  let seq = 0
  const browserScreencast = vi.fn(async () => {
    const subscriptionId = `browser-screencast:${PAGE}:${++seq}`
    let settle!: () => void
    const done = new Promise<void>((resolve) => {
      settle = resolve
    })
    let stops = 0
    const session: Session = {
      stop: () => {
        stops += 1
        settle()
      },
      done,
      stops: () => stops
    }
    return {
      subscriptionId,
      ready: {
        type: 'ready' as const,
        subscriptionId,
        browserPageId: PAGE,
        format: 'jpeg' as const,
        tab: { browserPageId: PAGE, index: 0, url: 'about:blank', title: 'Browser', active: true }
      },
      flushPendingFrame: () => {},
      session
    }
  })
  ;(runtime as unknown as { browserCommands: unknown }).browserCommands = { browserScreencast }

  const subscribe = (options: {
    connectionId: string
    clientKind?: 'mobile' | 'runtime'
  }): Subscriber => {
    const calls = browserScreencast.mock.results.length
    const emit = vi.fn()
    const done = runtime.browserScreencast(
      { worktree: `id:${WT}`, page: PAGE, format: 'jpeg' },
      { ...options, sendBinary: vi.fn(), emit }
    )
    const started = (): Promise<{ session: Session }> =>
      browserScreencast.mock.results[calls]?.value as Promise<{ session: Session }>
    let sessionRef: Session | null = null
    void started()?.then((value) => {
      sessionRef = value.session
    })
    return {
      done,
      stop: () => {
        void started()?.then(({ session }) => session.stop())
      },
      stops: () => sessionRef?.stops() ?? 0,
      // Why: every "no lock taken" assertion below is an absence, so it must not be allowed to pass
      // before the subscriber reached the point where the lock would have been taken.
      streaming: () =>
        vi.waitFor(() =>
          expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }))
        )
    }
  }

  return { runtime, subscribe, driver: () => runtime.getAllBrowserDrivers().get(PAGE) }
}

describe('browser screencast driver attribution', () => {
  it('takes the mobile presence lock for a phone-scoped subscriber', async () => {
    const { subscribe, driver } = createRuntime()
    const phone = subscribe({ connectionId: 'conn-phone', clientKind: 'mobile' })
    await phone.streaming()
    expect(driver()).toEqual({ kind: 'mobile', clientId: 'conn-phone' })
    phone.stop()
    await phone.done
  })

  it('leaves the page undriven for a paired desktop or web client viewing the same page', async () => {
    const { subscribe, driver } = createRuntime()
    const desktop = subscribe({ connectionId: 'conn-desktop', clientKind: 'runtime' })
    await desktop.streaming()
    expect(driver()).toBeUndefined()
    desktop.stop()
    await desktop.done
  })

  it('leaves the page undriven for an in-process subscriber that reports no pairing scope', async () => {
    const { subscribe, driver } = createRuntime()
    const local = subscribe({ connectionId: 'conn-local' })
    await local.streaming()
    expect(driver()).toBeUndefined()
    local.stop()
    await local.done
  })

  it('releases to idle when the phone leaves while a desktop client keeps watching', async () => {
    const { subscribe, driver } = createRuntime()
    const phone = subscribe({ connectionId: 'conn-phone', clientKind: 'mobile' })
    await phone.streaming()
    const desktop = subscribe({ connectionId: 'conn-desktop', clientKind: 'runtime' })
    await desktop.streaming()
    expect(driver()).toEqual({ kind: 'mobile', clientId: 'conn-phone' })

    phone.stop()
    await phone.done
    expect(driver()).toBeUndefined()
    desktop.stop()
    await desktop.done
  })

  it('hands the lock to a second phone when the first leaves', async () => {
    const { subscribe, driver } = createRuntime()
    const first = subscribe({ connectionId: 'conn-phone-a', clientKind: 'mobile' })
    await first.streaming()
    expect(driver()).toEqual({ kind: 'mobile', clientId: 'conn-phone-a' })
    const second = subscribe({ connectionId: 'conn-phone-b', clientKind: 'mobile' })
    await second.streaming()
    expect(driver()).toEqual({ kind: 'mobile', clientId: 'conn-phone-b' })

    second.stop()
    await second.done
    expect(driver()).toEqual({ kind: 'mobile', clientId: 'conn-phone-a' })
    first.stop()
    await first.done
  })

  it('take-back cancels the phone stream and leaves a desktop viewer streaming', async () => {
    const { runtime, subscribe, driver } = createRuntime()
    const phone = subscribe({ connectionId: 'conn-phone', clientKind: 'mobile' })
    await phone.streaming()
    expect(driver()).toEqual({ kind: 'mobile', clientId: 'conn-phone' })
    const desktop = subscribe({ connectionId: 'conn-desktop', clientKind: 'runtime' })
    await desktop.streaming()

    runtime.reclaimBrowserForDesktop(PAGE)
    await phone.done
    expect(driver()).toEqual({ kind: 'desktop' })
    expect(phone.stops()).toBe(1)
    expect(desktop.stops()).toBe(0)

    desktop.stop()
    await desktop.done
    // Presence check: the same counter does move for the desktop stream, so the 0 above is a real
    // survival and not a counter that never counts.
    expect(desktop.stops()).toBeGreaterThan(0)
  })
})

describe('browser.screencast RPC wiring', () => {
  it.each([
    ['mobile', 'mobile'],
    ['runtime', 'runtime'],
    [undefined, undefined]
  ] as const)(
    'forwards the caller pairing scope %s to the runtime',
    async (clientKind, expected) => {
      const browserScreencast = vi.fn(async () => {})
      const runtime = {
        getRuntimeId: () => 'test-runtime',
        browserScreencast,
        cleanupSubscription: vi.fn()
      } as unknown as OrcaRuntimeService
      const dispatcher = new RpcDispatcher({ runtime, methods: BROWSER_SCREENCAST_METHODS })

      await dispatcher.dispatchStreaming(
        { id: 'req-1', authToken: 'tok', method: 'browser.screencast', params: { page: PAGE } },
        () => {},
        { connectionId: 'conn-1', sendBinary: vi.fn(), ...(clientKind ? { clientKind } : {}) }
      )

      expect(browserScreencast).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ connectionId: 'conn-1', clientKind: expected })
      )
    }
  )
})
