import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { readHostBrowserPageIds, readHostBrowserPageUrl } from './helpers/host-session-tabs'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'
import {
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'

const CLIENT_NAME = 'STA-4150 client-hosted restart survival'

type MarkerFixture = {
  close(): Promise<void>
  markerUrl: string
  /** A second page the guest reaches on its own, to tell "survived" from "survived where". */
  movedUrl: string
  origin: string
}

async function startMarkerFixture(): Promise<MarkerFixture> {
  const server = createServer((request, response) => {
    const marker = request.url === '/moved' ? 'moved-on' : 'restart-survivor'
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8'
    })
    response.end(
      `<!doctype html><html><head><title>${marker}</title></head>` +
        `<body><h1 id="marker">${marker}</h1></body></html>`
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
    markerUrl: `${origin}/survivor`,
    movedUrl: `${origin}/moved`,
    origin
  }
}

/** Navigates the guest itself, the way following a link does — no client-side URL entry involved. */
async function navigateGuest(page: Page, fromUrl: string, toUrl: string): Promise<void> {
  const navigated = await page.evaluate(
    async ({ fromUrl, toUrl }) => {
      for (const candidate of document.querySelectorAll('webview')) {
        const webview = candidate as Electron.WebviewTag
        try {
          if (!webview.getURL().startsWith(fromUrl)) {
            continue
          }
          await webview.loadURL(toUrl)
          return true
        } catch {
          // The guest may still be attaching.
        }
      }
      return false
    },
    { fromUrl, toUrl }
  )
  if (!navigated) {
    throw new Error(`No client-hosted guest was showing ${fromUrl} to navigate`)
  }
}

type MirroredBrowserPage = {
  localPageId: string
  placementKind: 'client' | 'server' | null
  remotePageId: string
  url: string
}

async function findPairedWorktreeId(page: Page, repoPath: string): Promise<string | null> {
  return page.evaluate(
    (path) =>
      window.__store
        ?.getState()
        .allWorktrees()
        .find((worktree) => worktree.path === path)?.id ?? null,
    repoPath
  )
}

async function waitForPairedWorktreeId(page: Page, repoPath: string): Promise<string> {
  await expect
    .poll(() => findPairedWorktreeId(page, repoPath), {
      timeout: 120_000,
      message: 'paired client never received the host worktree'
    })
    .not.toBeNull()
  const worktreeId = await findPairedWorktreeId(page, repoPath)
  if (!worktreeId) {
    throw new Error('Paired worktree disappeared after discovery')
  }
  return worktreeId
}

async function selectPairedWorktreeGroup(
  page: Page,
  environmentId: string,
  worktreeId: string
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ environmentId, worktreeId }) => {
            const state = window.__store?.getState()
            state?.setActiveWorktree(worktreeId, `runtime:${environmentId}`)
            return state?.activeGroupIdByWorktree[worktreeId] ?? null
          },
          { environmentId, worktreeId }
        ),
      {
        timeout: 120_000,
        message: 'paired client never activated a tab group for the worktree'
      }
    )
    .not.toBeNull()
}

async function findMirroredBrowserPage(
  page: Page,
  worktreeId: string,
  url: string
): Promise<MirroredBrowserPage | null> {
  return page.evaluate(
    ({ url, worktreeId }) => {
      const state = window.__store?.getState()
      for (const workspace of state?.browserTabsByWorktree[worktreeId] ?? []) {
        for (const browserPage of state?.browserPagesByWorkspace[workspace.id] ?? []) {
          if (!browserPage.url.startsWith(url)) {
            continue
          }
          const handle = state?.remoteBrowserPageHandlesByPageId[browserPage.id]
          return {
            localPageId: browserPage.id,
            placementKind: handle?.placement?.kind ?? null,
            remotePageId: handle?.remotePageId ?? browserPage.id,
            url: browserPage.url
          }
        }
      }
      return null
    },
    { url, worktreeId }
  )
}

/** Every browser row the client holds for a worktree, for diagnosing duplicates and culls. */
async function readClientBrowserRows(
  page: Page,
  worktreeId: string
): Promise<{ pageId: string; placementKind: string | null; url: string }[]> {
  return page.evaluate((worktreeId) => {
    const state = window.__store?.getState()
    const rows: { pageId: string; placementKind: string | null; url: string }[] = []
    for (const workspace of state?.browserTabsByWorktree[worktreeId] ?? []) {
      for (const browserPage of state?.browserPagesByWorkspace[workspace.id] ?? []) {
        rows.push({
          pageId: browserPage.id,
          placementKind:
            state?.remoteBrowserPageHandlesByPageId[browserPage.id]?.placement?.kind ?? null,
          url: browserPage.url
        })
      }
    }
    return rows
  }, worktreeId)
}

async function createProductBrowserPage(page: Page, url: string): Promise<void> {
  await page.evaluate(async (url) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('Paired client has no active worktree')
    }
    const groupId = state.activeGroupIdByWorktree[state.activeWorktreeId]
    if (!groupId) {
      throw new Error('Paired client has no active tab group')
    }
    state.setBrowserDefaultUrl(url)
    await state.openNewBrowserTabInActiveWorkspace(groupId)
  }, url)
}

async function openClientHostedFixturePage(
  client: PairedElectronClient,
  worktreeId: string,
  url: string
): Promise<MirroredBrowserPage> {
  await createProductBrowserPage(client.page, url)
  await expect
    .poll(() => findMirroredBrowserPage(client.page, worktreeId, url), {
      timeout: 60_000,
      message: `paired client never materialized ${url}`
    })
    .not.toBeNull()
  const mirrored = await findMirroredBrowserPage(client.page, worktreeId, url)
  if (!mirrored) {
    throw new Error(`Mirrored browser page disappeared for ${url}`)
  }
  expect(mirrored.placementKind, 'fixture page must be hosted on the viewing desktop').toBe(
    'client'
  )
  await client.page.evaluate(
    ({ browserPageId, worktreeId }) => {
      window.__store?.getState().focusBrowserTabInWorktree(worktreeId, browserPageId, {
        surfacePane: true
      })
    },
    { browserPageId: mirrored.localPageId, worktreeId }
  )
  return mirrored
}

async function readClientWebviewMarker(page: Page, url: string): Promise<string | null> {
  return page.evaluate(async (prefix) => {
    for (const candidate of document.querySelectorAll('webview')) {
      const webview = candidate as Electron.WebviewTag
      try {
        if (!webview.getURL().startsWith(prefix)) {
          continue
        }
        return (await webview.executeJavaScript(
          'document.querySelector("#marker")?.textContent ?? null'
        )) as string | null
      } catch {
        // The guest may still be attaching.
      }
    }
    return null
  }, url)
}

async function waitForRenderedClientWebview(
  page: Page,
  url: string,
  message: string
): Promise<string> {
  await expect
    .poll(() => readClientWebviewMarker(page, url), { timeout: 120_000, message })
    .not.toBeNull()
  const marker = await readClientWebviewMarker(page, url)
  if (!marker) {
    throw new Error(`Client-hosted guest for ${url} lost its marker`)
  }
  return marker
}

async function refreshAuthorityRuntimeId(client: PairedElectronClient): Promise<string | null> {
  return client.page
    .evaluate(async (environmentId) => {
      await window.api.runtimeEnvironments.connect({ selector: environmentId })
      await window.__store?.getState().refreshRuntimeEnvironmentStatus(environmentId)
      return (
        window.__store?.getState().runtimeStatusByEnvironmentId.get(environmentId)?.status
          ?.runtimeId ?? null
      )
    }, client.environmentId)
    .catch(() => null)
}

/** Waits until the client is talking to a genuinely new runtime process, not the one it paired to. */
async function waitForRelaunchedRuntime(
  client: PairedElectronClient,
  previousRuntimeId: string
): Promise<void> {
  await expect
    .poll(() => refreshAuthorityRuntimeId(client), {
      timeout: 180_000,
      message: 'paired client never reconnected to a relaunched runtime process'
    })
    .toEqual(expect.not.stringMatching(`^${previousRuntimeId}$`))
}

/**
 * Server-restart half of the tab-persistence contract, and a known gap.
 *
 * The client-quit half ships (see paired-client-hosted-browser-quit-survival.spec.ts). This
 * direction does not, and the chain that blocks it was measured against this spec:
 *
 * 1. The client's lease reconnects with the runtime id it attached to, the relaunched runtime
 *    rejects it as `browser_client_host_authority_mismatch`, and the client retires the whole
 *    environment host — taking the guests it is still running down with it. Nothing re-attaches
 *    under the new identity: `ensureBrowserClientHostsForRestoredPages` only matches handles a
 *    session restore seeded.
 * 2. The runtime's client-hosted page registry is process memory, and the attach path can only
 *    reconcile pages it already has records for, so the client's inventory is never adopted.
 * 3. Adoption additionally has to reconcile command sequencing: page and host generations are
 *    per-process counters that restart at 1 and collide with the generations the client still
 *    holds, so a close/create pair for an imported page is rejected by the client dispatcher.
 *
 * Left as `fixme` rather than deleted: it is a working two-Electron reproduction, and the oracles
 * below (runtime-side page registry, single-row count, second-marker navigation) are what a fix
 * has to satisfy.
 */
test('keeps a client-hosted browser tab across a paired runtime restart', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(420_000)
  const fixture = await startMarkerFixture()
  const host = await launchHeadlessPairedRuntimeHost({ pinnedServePort: true })
  let client: PairedElectronClient | null = null
  try {
    await host.client.call('repo.add', { path: testRepoPath, kind: 'git' })
    client = await launchPairedElectronClient(host.offer, testInfo, CLIENT_NAME)
    const worktreeId = await waitForPairedWorktreeId(client.page, testRepoPath)
    await selectPairedWorktreeGroup(client.page, client.environmentId, worktreeId)

    const opened = await openClientHostedFixturePage(client, worktreeId, fixture.markerUrl)
    expect(
      await waitForRenderedClientWebview(
        client.page,
        fixture.markerUrl,
        'client-hosted guest never rendered the fixture'
      )
    ).toBe('restart-survivor')

    // Presence precondition: without it, every post-restart check could pass on a page the
    // runtime never held in the first place.
    expect(
      await readHostBrowserPageIds(host.client, testRepoPath),
      'the runtime must hold the client-hosted page before the restart'
    ).toContain(opened.remotePageId)

    // Why the guest moves before the restart: with the tab still on its create URL, recovering to
    // the create URL and recovering to where the user was are the same answer.
    await navigateGuest(client.page, fixture.markerUrl, fixture.movedUrl)
    expect(
      await waitForRenderedClientWebview(
        client.page,
        fixture.movedUrl,
        'the guest never rendered the page it navigated to'
      )
    ).toBe('moved-on')
    await expect
      .poll(() => readHostBrowserPageUrl(host.client, testRepoPath, opened.remotePageId), {
        timeout: 60_000,
        message: 'the runtime never learned where the guest navigated'
      })
      .toBe(fixture.movedUrl)

    const runtimeIdBeforeRestart = await refreshAuthorityRuntimeId(client)
    expect(runtimeIdBeforeRestart, 'client must know the runtime it is paired with').not.toBeNull()
    const hostPidBeforeRestart = host.app.process().pid

    await host.restartServeProcess()
    expect(host.app.process().pid, 'the serve process must actually be replaced').not.toBe(
      hostPidBeforeRestart
    )
    await waitForRelaunchedRuntime(client, runtimeIdBeforeRestart!)
    // The relaunched serve process starts from its user-data dir, so the repo is re-announced.
    await host.client.call('repo.add', { path: testRepoPath, kind: 'git' }).catch(() => undefined)
    const restartedWorktreeId = await waitForPairedWorktreeId(client.page, testRepoPath)
    await selectPairedWorktreeGroup(client.page, client.environmentId, restartedWorktreeId)

    await expect
      .poll(() => readHostBrowserPageIds(host.client, testRepoPath), {
        timeout: 180_000,
        message: 'the relaunched runtime never took the client-hosted page back'
      })
      .toContain(opened.remotePageId)

    await expect
      .poll(() => findMirroredBrowserPage(client!.page, restartedWorktreeId, fixture.origin), {
        timeout: 180_000,
        message: 'the client lost its client-hosted row across the runtime restart'
      })
      .not.toBeNull()

    // Counted across the whole fixture origin: a recovery that also replays the create URL leaves
    // two rows, and matching only the moved one would call that a pass.
    const rows = await readClientBrowserRows(client.page, restartedWorktreeId)
    const survivorRows = rows.filter((row) => row.url.startsWith(fixture.origin))
    expect(survivorRows, 'the tab must survive the restart exactly once').toHaveLength(1)

    const survivor = await findMirroredBrowserPage(
      client.page,
      restartedWorktreeId,
      fixture.origin
    )
    expect(
      survivor?.remotePageId,
      'recovery must keep the page identity it was created with'
    ).toBe(opened.remotePageId)
    expect(survivor?.placementKind, 'the surviving tab must still be client-hosted').toBe('client')

    expect(
      await waitForRenderedClientWebview(
        client.page,
        fixture.movedUrl,
        'the surviving tab never rendered its guest again'
      ),
      'the tab must come back where the user left it, not on its create URL'
    ).toBe('moved-on')
  } finally {
    if (client) {
      await cleanupE2EDaemons(client.userDataDir).catch(() => undefined)
      await client.dispose()
    }
    await host.dispose()
    await fixture.close()
  }
})
