import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { HistoryEntry } from '@shared/types'

/**
 * Historique de navigation local, persisté dans `userData/prism-history.json`. Même approche
 * que `sessionStore` : Map en mémoire + écriture debouncée. Sert la palette de commande
 * (recherche par frecency). 100 % local — aucune donnée n'est envoyée ailleurs.
 */

const HISTORY_FILE = 'prism-history.json'
const MAX_ENTRIES = 3000

/** Map url -> entrée. On garde tout en mémoire (borné à MAX_ENTRIES). */
const entries = new Map<string, HistoryEntry>()
let loaded = false

function historyPath(): string {
  return join(app.getPath('userData'), HISTORY_FILE)
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = readFileSync(historyPath(), 'utf-8')
    const parsed = JSON.parse(raw) as HistoryEntry[]
    for (const e of parsed) if (e?.url) entries.set(e.url, e)
  } catch {
    // Pas de fichier / illisible : on démarre vide.
  }
}

/** URL éligible à l'historique (on ignore les schémas internes). */
function isRecordable(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Enregistre / met à jour une visite. Title/favicon peuvent arriver plus tard (async). */
export function recordVisit(url: string, title?: string, favicon?: string | null): void {
  if (!isRecordable(url)) return
  ensureLoaded()
  const now = Date.now()
  const prev = entries.get(url)
  if (prev) {
    prev.visitCount += 1
    prev.lastVisit = now
    if (title) prev.title = title
    if (favicon !== undefined && favicon !== null) prev.favicon = favicon
  } else {
    entries.set(url, {
      url,
      title: title || url,
      favicon: favicon ?? null,
      visitCount: 1,
      lastVisit: now
    })
  }
  prune()
  scheduleWrite()
}

/**
 * Met à jour title/favicon de l'entrée d'une URL déjà visitée (sans compter une visite).
 * Appelée quand `page-title-updated` / `page-favicon-updated` arrivent après la navigation.
 */
export function updateMeta(url: string, patch: { title?: string; favicon?: string | null }): void {
  if (!isRecordable(url)) return
  ensureLoaded()
  const e = entries.get(url)
  if (!e) return
  if (patch.title) e.title = patch.title
  if (patch.favicon) e.favicon = patch.favicon
  scheduleWrite()
}

/** Poids de récence (bucketé) pour le classement frecency. */
function recencyWeight(lastVisit: number): number {
  const age = Date.now() - lastVisit
  const h = 3600_000
  const d = 24 * h
  if (age < h) return 100
  if (age < d) return 70
  if (age < 7 * d) return 50
  if (age < 30 * d) return 30
  return 10
}

function frecency(e: HistoryEntry): number {
  return recencyWeight(e.lastVisit) + e.visitCount * 10
}

/** Recherche substring (title/url) triée par frecency. query vide → plus récentes/fréquentes. */
export function searchHistory(query: string, limit = 6): HistoryEntry[] {
  ensureLoaded()
  const q = query.trim().toLowerCase()
  const all = [...entries.values()]
  const matched = q
    ? all.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q))
    : all
  return matched.sort((a, b) => frecency(b) - frecency(a)).slice(0, limit)
}

export function removeEntry(url: string): void {
  ensureLoaded()
  if (entries.delete(url)) scheduleWrite()
}

/** Élague les entrées les plus anciennes au-delà du cap. */
function prune(): void {
  if (entries.size <= MAX_ENTRIES) return
  const sorted = [...entries.values()].sort((a, b) => a.lastVisit - b.lastVisit)
  const toRemove = entries.size - MAX_ENTRIES
  for (let i = 0; i < toRemove; i++) entries.delete(sorted[i].url)
}

// --- Persistance debouncée ---
let timer: ReturnType<typeof setTimeout> | null = null

function writeNow(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(historyPath(), JSON.stringify([...entries.values()]), 'utf-8')
  } catch (err) {
    console.error('[historyStore] écriture échouée', err)
  }
}

function scheduleWrite(delay = 1000): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    writeNow()
  }, delay)
}

/** Flush synchrone (before-quit). */
export function flushHistory(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  writeNow()
}
