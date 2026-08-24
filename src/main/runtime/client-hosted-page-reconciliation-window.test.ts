import { describe, expect, it } from 'vitest'
import {
  ClientHostedPageReconciliationWindow,
  DEFAULT_CLIENT_HOSTED_RECONCILIATION_WINDOW_MS
} from './client-hosted-page-reconciliation-window'

const OPENED_AT = 1_700_000_000_000
const WINDOW_MS = DEFAULT_CLIENT_HOSTED_RECONCILIATION_WINDOW_MS

describe('ClientHostedPageReconciliationWindow', () => {
  it('reports unreconciled the instant it opens', () => {
    const window = new ClientHostedPageReconciliationWindow(OPENED_AT)

    expect(window.isUnreconciled(OPENED_AT)).toBe(true)
  })

  it('reports unreconciled part-way through the window', () => {
    const window = new ClientHostedPageReconciliationWindow(OPENED_AT)

    expect(window.isUnreconciled(OPENED_AT + WINDOW_MS / 2)).toBe(true)
  })

  // The first host attach is the answer the window was waiting for; nothing later reopens it.
  it('closes as soon as a host reconciles, well inside the window', () => {
    const window = new ClientHostedPageReconciliationWindow(OPENED_AT)
    window.markReconciled()

    expect(window.isUnreconciled(OPENED_AT + 1)).toBe(false)
    expect(window.isUnreconciled(OPENED_AT + WINDOW_MS / 2)).toBe(false)
  })

  // Elapsed === windowMs is already expired: the check is a strict `<`.
  it('closes at the exact deadline and beyond when no host ever attaches', () => {
    const window = new ClientHostedPageReconciliationWindow(OPENED_AT)

    expect(window.isUnreconciled(OPENED_AT + WINDOW_MS - 1)).toBe(true)
    expect(window.isUnreconciled(OPENED_AT + WINDOW_MS)).toBe(false)
    expect(window.isUnreconciled(OPENED_AT + WINDOW_MS + 10_000)).toBe(false)
  })

  it('stays reconciled across repeated marks and later queries', () => {
    const window = new ClientHostedPageReconciliationWindow(OPENED_AT)
    window.markReconciled()
    window.markReconciled()

    expect(window.isUnreconciled(OPENED_AT)).toBe(false)
    expect(window.isUnreconciled(OPENED_AT + 1_000)).toBe(false)
    expect(window.isUnreconciled(OPENED_AT + WINDOW_MS)).toBe(false)
    expect(window.isUnreconciled(OPENED_AT + WINDOW_MS * 2)).toBe(false)
  })

  it('honors a custom window length rather than the default bound', () => {
    const window = new ClientHostedPageReconciliationWindow(OPENED_AT, 100)

    expect(window.isUnreconciled(OPENED_AT + 99)).toBe(true)
    expect(window.isUnreconciled(OPENED_AT + 100)).toBe(false)
    expect(window.isUnreconciled(OPENED_AT + 101)).toBe(false)
  })

  // This bound is what stops a host that never returns from holding client-hosted rows open forever.
  it('bounds the default hold at 45 seconds', () => {
    expect(DEFAULT_CLIENT_HOSTED_RECONCILIATION_WINDOW_MS).toBe(45_000)
  })
})
