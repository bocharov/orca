// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectBrowserPageIds,
  useBrowserGuestPaintRetention
} from './browser-guest-paint-retention'
import { hydrateBrowserDrivers } from '../../../lib/pane-manager/browser-mobile-driver-state'
import { hydrateBrowserRemoteViewerPages } from '../../../lib/pane-manager/browser-remote-viewer-state'

describe('collectBrowserPageIds', () => {
  it('prefers the full page list so every guest under a tab is covered', () => {
    expect(
      collectBrowserPageIds([
        { id: 'tab-1', activePageId: 'page-a', pageIds: ['page-a', 'page-b'] }
      ])
    ).toEqual(['page-a', 'page-b'])
  })

  // Why: a split tab can hold a background page a phone is driving while a different page is
  // active; collecting only the active one would let that guest get parked.
  it('does not drop background pages in favour of the active one', () => {
    expect(
      collectBrowserPageIds([{ id: 't', activePageId: 'p1', pageIds: ['p1', 'p2'] }])
    ).toContain('p2')
  })

  it('falls back to the active page id when the list is empty', () => {
    expect(collectBrowserPageIds([{ id: 'tab-1', activePageId: 'page-a', pageIds: [] }])).toEqual([
      'page-a'
    ])
  })

  // Why: legacy single-page tabs reuse the tab id as the page id.
  it('falls back to the tab id when there is no active page', () => {
    expect(collectBrowserPageIds([{ id: 'tab-1' }])).toEqual(['tab-1'])
    expect(collectBrowserPageIds([{ id: 'tab-1', activePageId: null }])).toEqual(['tab-1'])
  })

  it('tolerates a missing worktree entry', () => {
    expect(collectBrowserPageIds(undefined)).toEqual([])
    expect(collectBrowserPageIds(null)).toEqual([])
  })

  it('flattens across tabs', () => {
    expect(
      collectBrowserPageIds([
        { id: 'tab-1', pageIds: ['a'] },
        { id: 'tab-2', pageIds: ['b', 'c'] }
      ])
    ).toEqual(['a', 'b', 'c'])
  })
})

describe('useBrowserGuestPaintRetention', () => {
  afterEach(() => {
    hydrateBrowserDrivers([])
    hydrateBrowserRemoteViewerPages([])
  })

  it('retains a hidden container for a phone driving one of its pages', () => {
    hydrateBrowserDrivers([
      { browserPageId: 'page-b', driver: { kind: 'mobile', clientId: 'phone-1' } }
    ])
    expect(
      renderHook(() => useBrowserGuestPaintRetention(['page-a', 'page-b'])).result.current
    ).toBe(true)
  })

  // Why: a paired desktop/web/CLI client never takes the presence lock, so the driver term above
  // cannot cover it and its stream would go dark behind a hidden ancestor.
  it('retains a hidden container for a page a paired client is watching', () => {
    hydrateBrowserRemoteViewerPages(['page-b'])
    expect(
      renderHook(() => useBrowserGuestPaintRetention(['page-a', 'page-b'])).result.current
    ).toBe(true)
  })

  it('releases a hidden container once nothing drives or watches its pages', () => {
    hydrateBrowserRemoteViewerPages(['page-elsewhere'])
    expect(
      renderHook(() => useBrowserGuestPaintRetention(['page-a', 'page-b'])).result.current
    ).toBe(false)
  })
})
