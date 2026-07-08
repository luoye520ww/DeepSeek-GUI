import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { findFileReferences } from './file-references'
import { previewWorkspaceFile, WORKSPACE_FILE_PREVIEW_EVENT, type WorkspaceFilePreviewDetail } from './workspace-file-preview'

const LINKIFIED_ATTR = 'data-kun-issue781-linkified'
const FILE_PATH_ATTR = 'data-kun-issue781-file-path'
const FILE_LINE_ATTR = 'data-kun-issue781-file-line'
const FILE_COLUMN_ATTR = 'data-kun-issue781-file-column'
const STYLE_ID = 'kun-issue-781-document-usability-style'

let installed = false
let observer: MutationObserver | null = null
let scanTimer: number | null = null
let lastPreviewTarget: WorkspaceFileTarget | null = null
let lastUserCloseAt = 0

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

function scheduleScan(): void {
  if (scanTimer !== null) return
  scanTimer = window.setTimeout(() => {
    scanTimer = null
    scanRenderedOutput()
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
  document.addEventListener('click', onDocumentClick, true)
  window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreviewEvent)
  observer = new MutationObserver(() => {
    scheduleScan()
    restorePreviewIfThreadSwitchClosedIt()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

installIssue781DocumentUsability()
