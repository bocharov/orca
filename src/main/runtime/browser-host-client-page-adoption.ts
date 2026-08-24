import type { BrowserClientHostedPageInventory } from '../../shared/browser-client-host-protocol'
import type { BrowserHostRuntimePageIntent } from './browser-host-page-reconciliation-plan'

/**
 * An inventory entry a restarted runtime may take back over. `workspaceId` is narrowed to present
 * because the runtime record it rebuilds cannot exist without one.
 */
export type AdoptableClientHostedPage = BrowserClientHostedPageInventory &
  Readonly<{ workspaceId: string }>

export type ClientHostedPageAdoptionCandidacy = {
  inventory: readonly BrowserClientHostedPageInventory[]
  browserHostClientId: string
  /** This process's id. An entry already naming it was placed by us, not by a predecessor. */
  authorityRuntimeId: string
  hasRuntimePage: (browserPageId: string) => boolean
}

/**
 * Picks the inventory entries a freshly started runtime may reclaim.
 *
 * Each guard fails closed on its own: a dead guest cannot be rekeyed, a workspace-less entry cannot
 * become a record, another host's page is not ours to take, an entry naming this process is one we
 * closed deliberately rather than lost to a restart, and a page we already track needs recovery
 * rather than adoption.
 */
export function selectAdoptableClientHostedPages(
  input: ClientHostedPageAdoptionCandidacy
): readonly AdoptableClientHostedPage[] {
  return input.inventory.filter((page): page is AdoptableClientHostedPage => {
    if (page.state !== 'active') {
      return false
    }
    if (page.workspaceId === undefined) {
      return false
    }
    if (page.browserHostClientId !== input.browserHostClientId) {
      return false
    }
    if (page.authorityRuntimeId === input.authorityRuntimeId) {
      return false
    }
    return !input.hasRuntimePage(page.browserPageId)
  })
}

export type ClientHostedPageAdoptionAuthority = {
  authorityRuntimeId: string
  authorityEpoch: string
}

export type ClientHostedPageAdoptionLease = {
  browserHostClientId: string
  browserHostGeneration: number
  pairedDeviceId: string
}

/**
 * Turns adoptable entries into restore intents under this runtime's authority.
 *
 * Deliberately no `reclaimFrom`: reclaim rekeys a live guest onto a new authority, but it requires
 * the execution-host key to be unchanged, and `native`/`wsl` keys name the runtime that minted them
 * (`browserNetworkExecutionHostKey`). A restart therefore invalidates the page's network route no
 * matter what, so the plan must close the orphaned guest and restore the tab at its last URL. The
 * tab survives; the DOM behind it cannot.
 *
 * Generations are handed out above every generation the inventory reports, because the placement
 * registry refuses a generation below one it has already issued.
 */
export function buildClientPageAdoptionIntents(input: {
  pages: readonly AdoptableClientHostedPage[]
  authority: ClientHostedPageAdoptionAuthority
  lease: ClientHostedPageAdoptionLease
  /** The key a page in that workspace would be created under now, not the one it was created under. */
  executionHostKeyByWorkspaceId: ReadonlyMap<string, string>
}): readonly BrowserHostRuntimePageIntent[] {
  const ordered = [...input.pages].sort(
    (left, right) => left.pageHostGeneration - right.pageHostGeneration
  )
  const baseGeneration = ordered.reduce(
    (highest, page) => Math.max(highest, page.pageHostGeneration),
    0
  )
  return ordered.flatMap((page, index) => {
    const executionHostKey = input.executionHostKeyByWorkspaceId.get(page.workspaceId)
    if (executionHostKey === undefined) {
      return []
    }
    return [
      Object.freeze({
        authorityRuntimeId: input.authority.authorityRuntimeId,
        authorityEpoch: input.authority.authorityEpoch,
        browserHostClientId: input.lease.browserHostClientId,
        browserHostGeneration: input.lease.browserHostGeneration,
        pageHostGeneration: baseGeneration + index + 1,
        browserPageId: page.browserPageId,
        browserProfileId: page.browserProfileId,
        executionHostKey,
        workspaceId: page.workspaceId
      })
    ]
  })
}
