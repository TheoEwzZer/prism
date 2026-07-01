import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { SessionData } from '@shared/types'

/**
 * Persistance simple de la session dans un fichier JSON (userData/prism-session.json).
 * Les onglets sont toujours restaurés en état "hibernated" (lazy) : leur WebContentsView
 * n'est recréée qu'au premier clic.
 */

const SESSION_FILE = 'prism-session.json'

const DEFAULT_SESSION: SessionData = {
  tabs: [],
  folders: [],
  pinnedApps: [
    { id: 'pin-gmail', name: 'Gmail', url: 'https://mail.google.com', favicon: null },
    { id: 'pin-cal', name: 'Agenda', url: 'https://calendar.google.com', favicon: null },
    { id: 'pin-gpt', name: 'ChatGPT', url: 'https://chat.openai.com', favicon: null }
  ],
  order: [],
  activeTabId: null,
  sidebarWidth: 256,
  sidebarCollapsed: false
}

function sessionPath(): string {
  return join(app.getPath('userData'), SESSION_FILE)
}

export function loadSession(): SessionData {
  try {
    const raw = readFileSync(sessionPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SessionData>
    // Fusion défensive + forçage de l'hibernation au boot (lazy loading).
    return {
      ...DEFAULT_SESSION,
      ...parsed,
      tabs: (parsed.tabs ?? []).map((t) => ({ ...t, isHibernated: true, isLoading: false }))
    }
  } catch {
    return { ...DEFAULT_SESSION }
  }
}

let pending: SessionData | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function writeNow(): void {
  if (!pending) return
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(sessionPath(), JSON.stringify(pending, null, 2), 'utf-8')
  } catch (err) {
    console.error('[sessionStore] écriture échouée', err)
  }
  pending = null
}

/** Sauvegarde debouncée (évite d'écrire sur disque à chaque frappe/navigation). */
export function saveSession(data: SessionData, delay = 800): void {
  pending = data
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    writeNow()
  }, delay)
}

/** Flush synchrone (à appeler sur before-quit). */
export function flushSession(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  writeNow()
}
