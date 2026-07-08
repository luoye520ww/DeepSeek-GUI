import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { findFileReferences } from './file-references'
import { previewWorkspaceFile, WORKSPACE_FILE_PREVIEW_EVENT, type WorkspaceFilePreviewDetail } from './workspace-file-preview'

const LINKIFIED_ATTR = 'data-kun-issue781-linkified'
const FILE_PATH_ATTR = 'data-kun-issue781-file-path'
const FILE_LINE_ATTR = 'data-kun-issue781-file-line'
const FILE_COLUMN_ATTR = 'data-kun-issue781-file-column'
const ENHANCED_ATTR = 'data-kun-issue781-enhanced'
const STYLE_ID = 'kun-issue-781-document-usability-style'
const PINNED_TABS_KEY = 'kun.issue781.pinnedPreviewTabs'
const SCROLL_POSITIONS_KEY = 'kun.issue781.previewScrollPositions'

let installed = false
let observer: MutationObserver | null = null
let scanTimer: number | null = null
let lastPreviewTarget: WorkspaceFileTarget | null = null
let lastUserCloseAt = 0
let menuEl: HTMLDivElement | null = null

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage quota / private-mode errors. The feature remains usable in-memory.
  }
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .ds-issue781-file-link {
      display: inline;
      max-width: 100%;
      border: 0;
      border-radius: 5px;
      background: color-mix(in srgb, var(--ds-accent) 10%, transparent);
      color: var(--ds-accent);
      cursor: pointer;
      font: inherit;
      padding: 0 2px;
      text-align: inherit;
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, var(--ds-accent) 45%, transparent);
      text-underline-offset: 2px;
    }
    .ds-issue781-file-link:hover {
      background: color-mix(in srgb, var(--ds-accent) 17%, transparent);
      text-decoration-color: var(--ds-accent);
    }
    .ds-code-sidebar-tab.kun-issue781-pinned::before {
      content: '📌';
      margin-right: 2px;
      font-size: 10px;
      opacity: 0.78;
    }
    .kun-issue781-menu {
      position: fixed;
      z-index: 9999;
      min-width: 172px;
      border: 1px solid var(--ds-border);
      border-radius: 10px;
      background: var(--ds-card);
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.22);
      padding: 5px;
    }
    .kun-issue781-menu button {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--ds-ink);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      padding: 7px 9px;
      text-align: left;
    }
    .kun-issue781-menu button:hover { background: var(--ds-hover); }
    .kun-issue781-reader-overlay {
      position: fixed;
      inset: 18px;
      z-index: 9998;
      display: flex;
      min-height: 0;
      flex-direction: column;
      border: 1px solid var(--ds-border);
      border-radius: 18px;
      background: var(--ds-main);
      box-shadow: 0 28px 80px rgba(15, 23, 42, 0.36);
      overflow: hidden;
    }
    .kun-issue781-reader-toolbar {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--ds-border-muted);
      background: var(--ds-sidebar);
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 650;
      color: var(--ds-ink);
    }
    .kun-issue781-reader-toolbar button,
    .kun-issue781-expand-button {
      border: 1px solid var(--ds-border-muted);
      border-radius: 8px;
      background: var(--ds-card);
      color: var(--ds-muted);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      padding: 5px 8px;
    }
    .kun-issue781-reader-toolbar button:hover,
    .kun-issue781-expand-button:hover {
      background: var(--ds-hover);
      color: var(--ds-ink);
    }
    .kun-issue781-reader-body {
      min-height: 0;
      flex: 1 1 auto;
      overflow: auto;
      padding: 18px min(7vw, 72px);
    }
    .kun-issue781-reader-body .ds-code-sidebar {
      height: auto;
      min-height: 100%;
      border-left: 0;
    }
    .kun-issue781-reader-body .ds-code-sidebar-topbar { display: none; }
  `
  document.head.appendChild(style)
}

function isBlockedTextNode(node: Text): boolean {
  const parent = node.parentElement
  if (!parent) return true
  return Boolean(parent.closest('a, button, textarea, script, style, [contenteditable="true"]'))
}

function targetFromDataset(element: HTMLElement): WorkspaceFileTarget | null {
  const path = element.getAttribute(FILE_PATH_ATTR)?.trim()
  if (!path) return null
  const line = Number.parseInt(element.getAttribute(FILE_LINE_ATTR) ?? '', 10)
  const column = Number.parseInt(element.getAttribute(FILE_COLUMN_ATTR) ?? '', 10)
  return {
    path,
    ...(Number.isFinite(line) && line > 0 ? { line } : {}),
    ...(Number.isFinite(column) && column > 0 ? { column } : {})
  }
}

function tabKey(tab: Element | null): string {
  return tab instanceof HTMLElement ? (tab.title || tab.textContent || '').trim() : ''
}

function activeTabKey(): string {
  return tabKey(document.querySelector('.ds-code-sidebar-tab.is-active'))
}

function pinnedTabs(): string[] {
  return readJson<string[]>(PINNED_TABS_KEY, [])
}

function setPinnedTabs(next: string[]): void {
  writeJson(PINNED_TABS_KEY, Array.from(new Set(next.filter(Boolean))))
}

function scrollPositions(): Record<string, number> {
  return readJson<Record<string, number>>(SCROLL_POSITIONS_KEY, {})
}

function setScrollPosition(key: string, value: number): void {
  if (!key) return
  const next = scrollPositions()
  next[key] = value
  writeJson(SCROLL_POSITIONS_KEY, next)
}

function recordPreviewTarget(target: WorkspaceFileTarget): void {
  lastPreviewTarget = target
}

function linkifyTextNode(node: Text): void {
  if (isBlockedTextNode(node)) return
  const text = node.nodeValue ?? ''
  const matches = findFileReferences(text)
  if (matches.length === 0) return

  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)))
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ds-issue781-file-link ds-file-reference-link'
    button.setAttribute(LINKIFIED_ATTR, '1')
    button.setAttribute(FILE_PATH_ATTR, match.target.path)
    if (match.target.line) button.setAttribute(FILE_LINE_ATTR, String(match.target.line))
    if (match.target.column) button.setAttribute(FILE_COLUMN_ATTR, String(match.target.column))
    button.title = match.target.line ? `${match.target.path}:${match.target.line}` : match.target.path
    button.textContent = match.text
    fragment.appendChild(button)
    cursor = match.end
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)))
  }
  node.replaceWith(fragment)
}

function linkifyContainer(container: ParentNode): void {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT
        if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
        return isBlockedTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      }
    }
  )
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) linkifyTextNode(node)
}

function scanRenderedOutput(): void {
  const containers = document.querySelectorAll('.ds-markdown, .ds-code-block-html, .ds-file-preview-code-html')
  for (const container of containers) linkifyContainer(container)
}

function applyPinnedClasses(): void {
  const pinned = new Set(pinnedTabs())
  document.querySelectorAll('.ds-code-sidebar-tab').forEach((tab) => {
    tab.classList.toggle('kun-issue781-pinned', pinned.has(tabKey(tab)))
  })
}

function closeIssue781Menu(): void {
  menuEl?.remove()
  menuEl = null
}

function showTabMenu(tab: HTMLElement, x: number, y: number): void {
  closeIssue781Menu()
  const key = tabKey(tab)
  const pinned = new Set(pinnedTabs())
  const menu = document.createElement('div')
  menu.className = 'kun-issue781-menu'
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  menu.innerHTML = `
    <button type="button" data-action="pin">${pinned.has(key) ? '取消固定标签' : '固定标签'}</button>
    <button type="button" data-action="close-others">关闭其他标签页</button>
  `
  menu.addEventListener('click', (event) => {
    const actionTarget = event.target
    if (!(actionTarget instanceof HTMLElement)) return
    const action = actionTarget.getAttribute('data-action')
    if (action === 'pin') {
      if (pinned.has(key)) pinned.delete(key)
      else pinned.add(key)
      setPinnedTabs([...pinned])
      applyPinnedClasses()
    } else if (action === 'close-others') {
      const pinnedNow = new Set(pinnedTabs())
      document.querySelectorAll('.ds-code-sidebar-tab').forEach((item) => {
        const itemKey = tabKey(item)
        if (item === tab || pinnedNow.has(itemKey)) return
        const close = item.querySelector('.ds-code-sidebar-tab-close')
        if (close instanceof HTMLButtonElement) close.click()
      })
    }
    closeIssue781Menu()
  })
  document.body.appendChild(menu)
  menuEl = menu
}

function enhancePreviewTabs(): void {
  applyPinnedClasses()
  const tabs = document.querySelector('.ds-code-sidebar-tabs')
  if (!(tabs instanceof HTMLElement) || tabs.getAttribute(ENHANCED_ATTR) === 'tabs') return
  tabs.setAttribute(ENHANCED_ATTR, 'tabs')
  tabs.addEventListener('wheel', (event) => {
    const tabList = Array.from(tabs.querySelectorAll('.ds-code-sidebar-tab')) as HTMLElement[]
    if (tabList.length < 2) return
    event.preventDefault()
    const activeIndex = Math.max(0, tabList.findIndex((tab) => tab.classList.contains('is-active')))
    const nextIndex = (activeIndex + (event.deltaY > 0 ? 1 : -1) + tabList.length) % tabList.length
    tabList[nextIndex]?.click()
  }, { passive: false })
  tabs.addEventListener('contextmenu', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const tab = target.closest('.ds-code-sidebar-tab')
    if (!(tab instanceof HTMLElement)) return
    event.preventDefault()
    showTabMenu(tab, event.clientX, event.clientY)
  })
}

function enhanceScrollMemory(): void {
  const scrollers = document.querySelectorAll('.ds-file-preview-scroll, .ds-file-preview-markdown')
  scrollers.forEach((element) => {
    if (!(element instanceof HTMLElement)) return
    if (element.getAttribute(ENHANCED_ATTR) !== 'scroll') {
      element.setAttribute(ENHANCED_ATTR, 'scroll')
      element.addEventListener('scroll', () => setScrollPosition(activeTabKey(), element.scrollTop), { passive: true })
    }
    const key = activeTabKey()
    const stored = scrollPositions()[key]
    if (key && typeof stored === 'number' && Math.abs(element.scrollTop - stored) > 4) {
      window.requestAnimationFrame(() => {
        element.scrollTop = stored
      })
    }
  })
}

function openReadingOverlay(): void {
  const sidebar = document.querySelector('.ds-code-sidebar')
  if (!(sidebar instanceof HTMLElement)) return
  document.querySelector('.kun-issue781-reader-overlay')?.remove()
  const active = activeTabKey()
  const overlay = document.createElement('div')
  overlay.className = 'kun-issue781-reader-overlay'
  overlay.innerHTML = `
    <div class="kun-issue781-reader-toolbar">
      <span>${active || 'Document preview'}</span>
      <button type="button" data-close="1">关闭</button>
    </div>
    <div class="kun-issue781-reader-body"></div>
  `
  overlay.querySelector('[data-close="1"]')?.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') overlay.remove()
  })
  const body = overlay.querySelector('.kun-issue781-reader-body')
  body?.appendChild(sidebar.cloneNode(true))
  document.body.appendChild(overlay)
  overlay.tabIndex = -1
  overlay.focus()
}

function enhanceReadingButton(): void {
  const actions = document.querySelector('.ds-code-sidebar-actions')
  if (!(actions instanceof HTMLElement) || actions.querySelector('.kun-issue781-expand-button')) return
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'kun-issue781-expand-button'
  button.title = '放大阅读'
  button.ariaLabel = '放大阅读'
  button.textContent = '阅读'
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    openReadingOverlay()
  })
  actions.insertBefore(button, actions.firstChild)
}

function scheduleScan(): void {
  if (scanTimer !== null) return
  scanTimer = window.setTimeout(() => {
    scanTimer = null
    scanRenderedOutput()
    enhancePreviewTabs()
    enhanceScrollMemory()
    enhanceReadingButton()
  }, 120)
}

function restorePreviewIfThreadSwitchClosedIt(): void {
  if (!lastPreviewTarget) return
  if (Date.now() - lastUserCloseAt < 1200) return
  if (document.querySelector('.ds-code-sidebar')) return
  window.setTimeout(() => {
    if (!lastPreviewTarget || document.querySelector('.ds-code-sidebar')) return
    previewWorkspaceFile(lastPreviewTarget)
  }, 180)
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const fileLink = target.closest(`[${LINKIFIED_ATTR}]`)
  if (fileLink instanceof HTMLElement) {
    const fileTarget = targetFromDataset(fileLink)
    if (!fileTarget) return
    event.preventDefault()
    event.stopPropagation()
    recordPreviewTarget(fileTarget)
    previewWorkspaceFile(fileTarget)
    return
  }

  if (target.closest('.ds-code-sidebar-actions button:last-child')) {
    lastUserCloseAt = Date.now()
  }
}

function onPreviewEvent(event: Event): void {
  const detail = (event as CustomEvent<WorkspaceFilePreviewDetail>).detail
  if (!detail?.path) return
  recordPreviewTarget(detail)
}

export function installIssue781DocumentUsability(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return
  installed = true
  injectStyle()
  scanRenderedOutput()
  enhancePreviewTabs()
  enhanceScrollMemory()
  enhanceReadingButton()
  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('pointerdown', (event) => {
    if (menuEl && event.target instanceof Node && !menuEl.contains(event.target)) closeIssue781Menu()
  }, true)
  window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreviewEvent)
  observer = new MutationObserver(() => {
    scheduleScan()
    restorePreviewIfThreadSwitchClosedIt()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

installIssue781DocumentUsability()
