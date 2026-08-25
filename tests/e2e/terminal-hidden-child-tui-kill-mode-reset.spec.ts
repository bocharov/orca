import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveTabId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { stageNodeScriptForTerminal } from './helpers/run-node-script-in-terminal'

async function activateTerminalTab(page: Page, tabId: string): Promise<void> {
  await page.evaluate((id) => {
    const state = window.__store?.getState()
    state?.setActiveTab(id)
    state?.setActiveTabType('terminal')
  }, tabId)
  await expect
    .poll(() =>
      page.locator('[data-testid="sortable-tab"][data-active="true"]').getAttribute('data-tab-id')
    )
    .toBe(tabId)
}

test('clears modes when a child TUI is killed while its shell survives hidden', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)

  const shellTabId = (await getActiveTabId(orcaPage))!
  const child = [
    "process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdout.write('\\x1b[?1049h\\x1b[?1003h\\x1b[?1006h\\x1b[?25lCHILD_TUI_STARTED\\r\\n')",
    "setInterval(() => process.stdout.write('\\x1b[2J\\x1b[HCHILD_TUI_FRAME\\r\\n'), 80)"
  ].join(';')
  const parent = [
    `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});`,
    'setTimeout(() => process.kill(child.pid, "SIGKILL"), 3000);',
    "child.on('exit', () => process.stdout.write('\\r\\nCHILD_TUI_KILLED\\r\\n'))"
  ].join(' ')
  const command = stageNodeScriptForTerminal(parent, { prefix: 'orca-child-tui-kill' }).command
  const tuiTabId = await orcaPage.evaluate(
    ({ command }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (!state || !worktreeId) {
        throw new Error('store/worktree unavailable')
      }
      const tab = state.createTab(worktreeId)
      state.queueTabStartupCommand(tab.id, { command })
      state.setActiveTab(tab.id)
      state.setActiveTabType('terminal')
      return tab.id
    },
    { command }
  )

  await expect
    .poll(() => getTerminalContent(orcaPage, 6_000), { timeout: 8_000 })
    .toContain('CHILD_TUI_FRAME')
  const tuiPtyId = await orcaPage.evaluate((tabId) => {
    const manager = window.__paneManagers?.get(tabId)
    return manager?.getActivePane?.()?.container?.dataset?.ptyId ?? null
  }, tuiTabId)
  expect(tuiPtyId).not.toBeNull()
  await activateTerminalTab(orcaPage, shellTabId)
  await expect
    .poll(
      () =>
        orcaPage.evaluate(async (ptyId) => {
          const processName = await window.api.pty.getForegroundProcess(ptyId)
          return processName?.toLowerCase() ?? null
        }, tuiPtyId!),
      { timeout: 8_000 }
    )
    .toMatch(/^(bash|zsh|sh|fish)(\.exe)?$/)
  await activateTerminalTab(orcaPage, tuiTabId)

  const shellInputMarker = `SHELL_INPUT_AFTER_TUI_KILL_${Date.now()}`
  const revealedPtyId = await orcaPage.evaluate((tabId) => {
    const manager = window.__paneManagers?.get(tabId)
    return manager?.getActivePane?.()?.container?.dataset?.ptyId ?? null
  }, tuiTabId)
  expect(revealedPtyId).not.toBeNull()
  await execInTerminal(orcaPage, revealedPtyId!, `printf ${shellInputMarker}`)
  await expect
    .poll(() => getTerminalContent(orcaPage, 6_000), { timeout: 8_000 })
    .toContain(shellInputMarker)

  const terminalState = await orcaPage.evaluate((tabId) => {
    const manager = window.__paneManagers?.get(tabId)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
    return {
      buffer: pane?.terminal.buffer.active.type,
      mouse: pane?.terminal.modes.mouseTrackingMode
    }
  }, tuiTabId)
  expect(terminalState).toEqual({ buffer: 'normal', mouse: 'none' })
})
