export const DEFAULT_CLIENT_HOSTED_RECONCILIATION_WINDOW_MS = 45_000

/**
 * Tracks whether this runtime has yet heard from the paired hosts holding its client-hosted pages.
 *
 * A restarted runtime rehydrates terminals from disk and starts publishing session-tab snapshots
 * immediately, but it cannot know about client-hosted browser pages until a host attaches and
 * reports them. Those first snapshots therefore look authoritative while being silently empty of
 * browser rows, and a client that trusts them culls its own live tabs.
 *
 * The window closes on the first host attach, or on a deadline if none comes — an unbounded hold
 * would leave rows for pages nothing is hosting, which is the failure this exists to avoid.
 */
export class ClientHostedPageReconciliationWindow {
  private reconciled = false

  constructor(
    private readonly openedAt: number,
    private readonly windowMs: number = DEFAULT_CLIENT_HOSTED_RECONCILIATION_WINDOW_MS
  ) {}

  markReconciled(): void {
    this.reconciled = true
  }

  isUnreconciled(now: number): boolean {
    return !this.reconciled && now - this.openedAt < this.windowMs
  }
}
