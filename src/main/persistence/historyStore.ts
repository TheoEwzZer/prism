import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { HistoryEntry, VisitEntry, HistoryListInput, HistoryListResult } from '@shared/types'

/**
 * Historique de navigation local, persisté dans `userData/prism-history.json`. Même approche
 * que `sessionStore` : état en mémoire + écriture debouncée. 100 % local — rien n'est envoyé
 * ailleurs.
 *
 * Source de vérité : un **journal append-only de visites** (une ligne par navigation, avec
 * timestamp), qui alimente la page Historique (Ctrl+H, groupée par jour). L'agrégat par URL
 * (frecency) servant la palette de commande en est **dérivé** et maintenu en mémoire.
 */

const HISTORY_FILE = 'prism-history.json'
/** Cap du journal de visites (les plus anciennes sont élaguées au-delà). */
const MAX_VISITS = 10000

/** Journal des visites, trié par `ts` croissant (ordre d'insertion). Source de vérité. */
let visits: VisitEntry[] = []
/** Vue agrégée url -> entrée (frecency), dérivée de `visits`. */
const aggregated = new Map<string, HistoryEntry>()
let loaded = false
let idSeq = 0

function historyPath(): string {
  return join(app.getPath('userData'), HISTORY_FILE)
}

/** Id de visite raisonnablement unique (ordre + timestamp), stable en persistance. */
function nextId(ts: number): string {
  return `${ts.toString(36)}-${(idSeq++).toString(36)}`
}

/** URL éligible à l'historique (on ignore les schémas internes). */
function isRecordable(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = readFileSync(historyPath(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      // Ancien format : HistoryEntry[] agrégé → une visite synthétique par entrée (migration).
      for (const e of parsed as HistoryEntry[]) {
        if (!e?.url) continue
        visits.push({
          id: nextId(e.lastVisit ?? Date.now()),
          url: e.url,
          title: e.title || e.url,
          favicon: e.favicon ?? null,
          ts: e.lastVisit ?? Date.now()
        })
      }
    } else if (parsed && Array.isArray((parsed as { visits?: unknown }).visits)) {
      const raws = (parsed as { visits: VisitEntry[] }).visits
      for (const v of raws) if (v?.url && typeof v.ts === 'number') visits.push(v)
    }
  } catch {
    // Pas de fichier / illisible : on démarre vide.
  }
  visits.sort((a, b) => a.ts - b.ts)
  rebuildAggregate()
}

/** Reconstruit intégralement l'agrégat frecency depuis le journal (après suppression massive). */
function rebuildAggregate(): void {
  aggregated.clear()
  for (const v of visits) mergeIntoAggregate(v)
}

/** Fusionne une visite dans l'agrégat (incrément du compteur + méta la plus récente). */
function mergeIntoAggregate(v: VisitEntry): void {
  const prev = aggregated.get(v.url)
  if (prev) {
    prev.visitCount += 1
    if (v.ts >= prev.lastVisit) {
      prev.lastVisit = v.ts
      if (v.title) prev.title = v.title
      if (v.favicon) prev.favicon = v.favicon
    }
  } else {
    aggregated.set(v.url, {
      url: v.url,
      title: v.title || v.url,
      favicon: v.favicon ?? null,
      visitCount: 1,
      lastVisit: v.ts
    })
  }
}

/** Enregistre une visite. Title/favicon peuvent arriver plus tard (voir `updateMeta`). */
export function recordVisit(url: string, title?: string, favicon?: string | null): void {
  if (!isRecordable(url)) return
  ensureLoaded()
  const now = Date.now()
  const v: VisitEntry = {
    id: nextId(now),
    url,
    title: title || url,
    favicon: favicon ?? null,
    ts: now
  }
  visits.push(v)
  mergeIntoAggregate(v)
  prune()
  scheduleWrite()
}

/**
 * Met à jour title/favicon (sans compter de visite) : sur l'agrégat ET sur la visite la plus
 * récente de cette URL. Appelée quand `page-title-updated` / `page-favicon-updated` arrivent.
 */
export function updateMeta(url: string, patch: { title?: string; favicon?: string | null }): void {
  if (!isRecordable(url)) return
  ensureLoaded()
  const e = aggregated.get(url)
  if (!e) return
  if (patch.title) e.title = patch.title
  if (patch.favicon) e.favicon = patch.favicon
  for (let i = visits.length - 1; i >= 0; i--) {
    if (visits[i].url === url) {
      if (patch.title) visits[i].title = patch.title
      if (patch.favicon) visits[i].favicon = patch.favicon
      break
    }
  }
  scheduleWrite()
}

// --- Frecency (palette de commande) ---

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
  const all = [...aggregated.values()]
  const matched = q
    ? all.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q))
    : all
  return matched.sort((a, b) => frecency(b) - frecency(a)).slice(0, limit)
}

// --- Page Historique (chronologique, paginée) ---

/**
 * Page de visites du plus récent au plus ancien, filtrée par `query` et paginée (offset/limit).
 * Filtrage + pagination faits ici (côté Main) pour ne transférer qu'une page au Renderer.
 */
export function listHistory(input: HistoryListInput): HistoryListResult {
  ensureLoaded()
  const q = (input.query ?? '').trim().toLowerCase()
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const offset = Math.max(input.offset ?? 0, 0)
  const items: VisitEntry[] = []
  let matched = 0
  for (let i = visits.length - 1; i >= 0; i--) {
    const v = visits[i]
    if (q && !(v.title.toLowerCase().includes(q) || v.url.toLowerCase().includes(q))) continue
    matched++
    if (matched > offset && items.length < limit) items.push(v)
  }
  return { items, hasMore: offset + items.length < matched }
}

/** Supprime toutes les visites d'une URL (utilisé par la palette de commande). */
export function removeEntry(url: string): void {
  ensureLoaded()
  const before = visits.length
  visits = visits.filter((v) => v.url !== url)
  if (visits.length !== before) {
    aggregated.delete(url)
    scheduleWrite()
  }
}

/** Supprime une visite précise (par id) depuis la page Historique. */
export function removeVisit(id: string): void {
  ensureLoaded()
  const before = visits.length
  visits = visits.filter((v) => v.id !== id)
  if (visits.length !== before) {
    rebuildAggregate()
    scheduleWrite()
  }
}

/** Efface l'historique : tout (`since` absent) ou les visites depuis `since` (timestamp ms). */
export function clearHistory(since?: number): void {
  ensureLoaded()
  visits = since === undefined ? [] : visits.filter((v) => v.ts < since)
  rebuildAggregate()
  scheduleWrite()
}

/** Élague les visites les plus anciennes au-delà du cap (journal trié par ts croissant). */
function prune(): void {
  if (visits.length <= MAX_VISITS) return
  const removed = visits.splice(0, visits.length - MAX_VISITS)
  // L'agrégat incrémental a compté ces visites : on le reconstruit pour rester cohérent.
  if (removed.length > 0) rebuildAggregate()
}

// --- Persistance debouncée ---
let timer: ReturnType<typeof setTimeout> | null = null

function writeNow(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(historyPath(), JSON.stringify({ v: 2, visits }), 'utf-8')
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
