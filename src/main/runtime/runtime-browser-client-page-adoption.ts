import type { BrowserClientHostedPageInventory } from '../../shared/browser-client-host-protocol'
import type { BrowserHostLease } from './browser-host-lease-records'
import type { BrowserHostLeaseRegistry } from './browser-host-lease-registry'
import {
  buildClientPageAdoptionIntents,
  selectAdoptableClientHostedPages
} from './browser-host-client-page-adoption'
import type { RuntimeBrowserPageRegistry } from './runtime-browser-page-registry'

type AdoptionAuthority = Pick<
  BrowserHostLeaseRegistry,
  'authorityRuntimeId' | 'authorityEpoch' | 'adoptClientPages' | 'getPlacement'
>

export type RuntimeBrowserClientPageAdoptionOptions = {
  lease: BrowserHostLease
  authority: AdoptionAuthority
  pages: RuntimeBrowserPageRegistry
  notifyWorkspace: (workspaceId: string) => void
  /**
   * The execution-host key that workspace's pages would be created under now. Undefined for a
   * workspace this runtime can no longer resolve, which drops its pages from adoption entirely.
   */
  resolveExecutionHostKey: (workspaceId: string) => Promise<string | undefined>
  signal?: AbortSignal
}

/**
 * Rebuilds this runtime's client-hosted page records from the inventory an attaching host reports.
 *
 * A runtime restart loses the page registry but not the guests: the client still holds them, and
 * `reclaimPage` rekeys a live guest onto the new authority rather than recreating it. Adoption is
 * best effort -- a page it cannot take stays the client's problem to retire, and never fails attach.
 */
export async function adoptRuntimeBrowserClientPagesFromInventory(
  options: RuntimeBrowserClientPageAdoptionOptions
): Promise<readonly string[]> {
  const inventory = options.lease.pageInventory
  if (
    options.lease.pageReconciliationProtocolVersion !== 1 ||
    options.lease.pageInventoryProtocolVersion !== 1 ||
    options.lease.pageCommandProtocolVersion !== 1 ||
    !inventory
  ) {
    return []
  }
  const adoptable = selectAdoptableClientHostedPages({
    inventory,
    browserHostClientId: options.lease.browserHostClientId,
    authorityRuntimeId: options.authority.authorityRuntimeId,
    hasRuntimePage: (browserPageId) => options.pages.getPage(browserPageId) !== undefined
  })
  if (adoptable.length === 0) {
    return []
  }
  const executionHostKeyByWorkspaceId = new Map<string, string>()
  for (const workspaceId of new Set(adoptable.map((page) => page.workspaceId))) {
    const executionHostKey = await options.resolveExecutionHostKey(workspaceId)
    if (executionHostKey !== undefined) {
      executionHostKeyByWorkspaceId.set(workspaceId, executionHostKey)
    }
  }
  const intents = buildClientPageAdoptionIntents({
    pages: adoptable,
    authority: {
      authorityRuntimeId: options.authority.authorityRuntimeId,
      authorityEpoch: options.authority.authorityEpoch
    },
    lease: {
      browserHostClientId: options.lease.browserHostClientId,
      browserHostGeneration: options.lease.browserHostGeneration
    },
    executionHostKeyByWorkspaceId
  })
  if (intents.length === 0) {
    return []
  }
  const intentsByPageId = new Map(intents.map((intent) => [intent.browserPageId, intent]))
  const adoptedPageIds = new Set(
    await options.authority.adoptClientPages(
      {
        authorityEpoch: options.lease.authorityEpoch,
        browserHostClientId: options.lease.browserHostClientId,
        browserHostGeneration: options.lease.browserHostGeneration,
        pairedDeviceId: options.lease.pairedDeviceId
      },
      intents,
      options.signal ? { signal: options.signal } : {}
    )
  )
  const byPageId = new Map(adoptable.map((page) => [page.browserPageId, page]))
  const publishedWorkspaces = new Set<string>()
  for (const browserPageId of adoptedPageIds) {
    const page = byPageId.get(browserPageId)
    const intent = intentsByPageId.get(browserPageId)
    const placement = options.authority.getPlacement(browserPageId)
    if (!page || !intent || placement?.kind !== 'client') {
      continue
    }
    try {
      options.pages.publishClientPage({
        browserPageId,
        workspaceId: page.workspaceId,
        browserProfileId: page.browserProfileId,
        executionHostKey: intent.executionHostKey,
        placement,
        pairedDeviceId: options.lease.pairedDeviceId,
        url: adoptedPageUrl(page),
        loading: false,
        // Adoption never decides focus: activating here would deactivate whichever sibling the
        // client is actually showing, and the client republishes its own activation.
        active: false
      })
      publishedWorkspaces.add(page.workspaceId)
    } catch (error) {
      console.warn('[browser-host-lease] client page adoption publish failed:', {
        browserPageId,
        error
      })
    }
  }
  for (const workspaceId of publishedWorkspaces) {
    options.notifyWorkspace(workspaceId)
  }
  return [...publishedWorkspaces]
}

function adoptedPageUrl(page: BrowserClientHostedPageInventory): string {
  return page.currentUrl ?? 'about:blank'
}
