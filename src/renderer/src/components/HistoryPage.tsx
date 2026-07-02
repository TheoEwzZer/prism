import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, ExternalLink, Globe, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTabsStore } from '@/store/tabsStore'
import type { VisitEntry } from '@shared/types'

/** Taille d'une page chargée (défilement infini). */
const PAGE = 100
const SEARCH_DEBOUNCE_MS = 200
const DAY_MS = 86_400_000

const dayLabelFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
})
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Libellé d'un jour : « Aujourd'hui » / « Hier » / date complète. */
function dayLabel(dayStart: number): string {
  const today = startOfDay(Date.now())
  if (dayStart === today) return "Aujourd'hui"
  if (dayStart === today - DAY_MS) return 'Hier'
  return capitalize(dayLabelFmt.format(dayStart))
}

/** URL raccourcie pour l'affichage (host + chemin sans slash final). */
function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    return (u.host + u.pathname).replace(/\/$/, '')
  } catch {
    return url
  }
}

interface DayGroup {
  key: number
  label: string
  items: VisitEntry[]
}

/**
 * Page Historique — onglet interne `prism://history/` (façon Arc). Rendue par le chrome React
 * DANS la zone contenu (voir `WebViewArea`) : c'est une vraie page, pas une modal — l'onglet a une
 * URL, apparaît dans la sidebar et se ferme comme n'importe quel onglet. Visites groupées par jour
 * (heure affichée), filtre plein texte, défilement infini (pagination côté Main), sélection
 * multiple (ouvrir / supprimer en lot) et effacement par plage.
 */
export function HistoryPage(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState<VisitEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  // Sélection multiple (ids de visites). Toujours un sous-ensemble des visites chargées.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // reqRef invalide les réponses périmées (recherche/reset) ; loadingMore garde-fou du défilement.
  const reqRef = useRef(0)
  const itemsRef = useRef<VisitEntry[]>([])
  const loadingMoreRef = useRef(false)
  // Miroir de `items` pour calculer l'offset dans `loadMore` sans le remettre dans ses deps.
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Débounce du filtre.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  // (Re)charge la première page à chaque changement de filtre ou rafraîchissement (suppression).
  // On ne repasse pas `loading` à true à chaque frappe (setState synchrone dans l'effet) : les
  // anciens résultats restent affichés ~200 ms jusqu'à la nouvelle page (requête locale rapide).
  useEffect(() => {
    const id = ++reqRef.current
    loadingMoreRef.current = false
    window.prism.listHistory({ query: debounced, offset: 0, limit: PAGE }).then((res) => {
      if (id !== reqRef.current) return
      setItems(res.items)
      setHasMore(res.hasMore)
      setLoading(false)
      setSelected(new Set()) // nouvelle recherche / rafraîchissement : on repart sans sélection
    })
  }, [debounced, refreshTick])

  const loadMore = useCallback((): void => {
    if (loadingMoreRef.current || !hasMore) return
    loadingMoreRef.current = true
    const id = reqRef.current
    window.prism
      .listHistory({ query: debounced, offset: itemsRef.current.length, limit: PAGE })
      .then((res) => {
        if (id !== reqRef.current) {
          loadingMoreRef.current = false
          return
        }
        // Dédup par id (robustesse si une suppression a décalé les offsets entre-temps).
        setItems((prev) => {
          const seen = new Set(prev.map((v) => v.id))
          return [...prev, ...res.items.filter((v) => !seen.has(v.id))]
        })
        setHasMore(res.hasMore)
        loadingMoreRef.current = false
      })
  }, [debounced, hasMore])

  // Défilement infini via IntersectionObserver sur une sentinelle en bas de liste.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { root: scrollRef.current, rootMargin: '400px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  // Clic sur une visite → on navigue l'onglet courant (l'onglet historique) vers le site : la page
  // interne est alors remplacée par la vraie page (comportement « la page devient le site »).
  const openUrl = useCallback((url: string): void => {
    const activeId = useTabsStore.getState().activeTabId
    if (activeId) window.prism.navigate(activeId, url)
    else window.prism.createTab({ url })
  }, [])

  const removeVisit = useCallback((id: string): void => {
    window.prism.removeVisit(id)
    setItems((prev) => prev.filter((v) => v.id !== id))
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const clear = (since?: number): void => {
    window.prism.clearHistory(since)
    setRefreshTick((t) => t + 1)
  }

  const toggleSelect = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Sélectionner / désélectionner toutes les visites actuellement chargées.
  const toggleSelectAll = (): void => {
    setSelected((prev) =>
      prev.size === itemsRef.current.length ? new Set() : new Set(itemsRef.current.map((v) => v.id))
    )
  }

  const clearSelection = (): void => setSelected(new Set())

  // Ouvre toutes les visites sélectionnées (URLs dédupliquées) dans de nouveaux onglets en arrière-plan.
  const openSelected = (): void => {
    const urls = new Set<string>()
    for (const v of items) if (selected.has(v.id)) urls.add(v.url)
    for (const url of urls) window.prism.createTab({ url, activate: false })
    clearSelection()
  }

  // Supprime toutes les visites sélectionnées.
  const removeSelected = (): void => {
    for (const id of selected) window.prism.removeVisit(id)
    setItems((prev) => prev.filter((v) => !selected.has(v.id)))
    setSelected(new Set())
  }

  // Regroupement par jour (les visites arrivent déjà triées du plus récent au plus ancien).
  const groups = useMemo<DayGroup[]>(() => {
    const out: DayGroup[] = []
    let current: DayGroup | null = null
    for (const v of items) {
      const d = startOfDay(v.ts)
      if (!current || current.key !== d) {
        current = { key: d, label: dayLabel(d), items: [] }
        out.push(current)
      }
      current.items.push(v)
    }
    return out
  }, [items])

  const empty = !loading && items.length === 0

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-slate-200">
      {/* En-tête : titre + recherche + effacer */}
      <header className="flex items-center gap-3 border-b border-white/10 px-6 py-4">
        <Clock className="size-5 shrink-0 text-slate-400" />
        <h1 className="shrink-0 text-lg font-semibold">Historique</h1>
        <div className="relative mx-auto w-full max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-500" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer l'historique…"
            className="h-9 border-white/10 bg-white/5 pl-8 text-sm text-slate-200 placeholder:text-slate-500"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-slate-300">
              <Trash2 className="size-4" />
              Effacer
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 border-white/10 bg-popover p-1.5">
            <ClearItem label="La dernière heure" onClick={() => clear(Date.now() - 3600_000)} />
            <ClearItem label="Aujourd'hui" onClick={() => clear(startOfDay(Date.now()))} />
            <ClearItem
              label="Les 7 derniers jours"
              onClick={() => clear(startOfDay(Date.now()) - 6 * DAY_MS)}
            />
            <ClearItem label="Tout l'historique" destructive onClick={() => clear()} />
          </PopoverContent>
        </Popover>
      </header>

      {/* Barre de sélection multiple (visible dès qu'une visite est cochée) */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-6 py-2">
          <Checkbox
            checked={selected.size === items.length ? true : 'indeterminate'}
            onCheckedChange={toggleSelectAll}
            aria-label="Tout sélectionner"
          />
          <span className="text-sm text-slate-300">
            {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={openSelected}
              className="gap-1.5 text-slate-200"
            >
              <ExternalLink className="size-4" />
              Ouvrir
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={removeSelected}
              className="gap-1.5 text-red-400 hover:text-red-300"
            >
              <Trash2 className="size-4" />
              Supprimer
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearSelection}
              aria-label="Annuler la sélection"
              className="text-slate-400 hover:text-white"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Corps : liste groupée par jour, défilement infini */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-2 py-3">
          {empty && (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-slate-500">
              <Clock className="size-8 opacity-40" />
              <p className="text-sm">
                {debounced ? 'Aucun résultat.' : 'Aucun historique pour le moment.'}
              </p>
            </div>
          )}

          {groups.map((group) => (
            <section key={group.key} className="mb-1">
              <h2 className="sticky top-0 z-10 bg-background/95 px-3 py-2 text-xs font-semibold tracking-wide text-slate-400 backdrop-blur-sm">
                {group.label}
              </h2>
              {group.items.map((v) => (
                <HistoryRow
                  key={v.id}
                  visit={v}
                  selected={selected.has(v.id)}
                  onToggle={toggleSelect}
                  onOpen={openUrl}
                  onRemove={removeVisit}
                />
              ))}
            </section>
          ))}

          {/* Sentinelle de défilement infini */}
          {hasMore && <div ref={sentinelRef} className="h-8" />}
        </div>
      </div>
    </div>
  )
}

/** Une ligne de visite (mémoïsée : la survol/suppression d'une autre ligne ne la re-rend pas). */
const HistoryRow = memo(function HistoryRow({
  visit,
  selected,
  onToggle,
  onOpen,
  onRemove
}: {
  visit: VisitEntry
  selected: boolean
  onToggle: (id: string) => void
  onOpen: (url: string) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(visit.url)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(visit.url)
      }}
      data-selected={selected || undefined}
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 outline-none hover:bg-white/5 focus-visible:bg-white/5 data-[selected]:bg-primary/15"
    >
      <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle(visit.id)}
          aria-label="Sélectionner cette visite"
        />
      </span>
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-slate-500">
        {timeFmt.format(visit.ts)}
      </span>
      {visit.favicon ? (
        <img src={visit.favicon} alt="" className="size-4 shrink-0 rounded-sm" />
      ) : (
        <Globe className="size-4 shrink-0 text-slate-500" />
      )}
      <span className="min-w-0 shrink truncate text-sm font-medium text-slate-200">
        {visit.title || visit.url}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{prettyUrl(visit.url)}</span>
      <button
        aria-label="Supprimer de l'historique"
        title="Supprimer de l'historique"
        onClick={(e) => {
          e.stopPropagation()
          onRemove(visit.id)
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
})

/** Une option du menu « Effacer ». */
function ClearItem({
  label,
  destructive,
  onClick
}: {
  label: string
  destructive?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-white/10 ${
        destructive ? 'text-red-400 hover:text-red-300' : 'text-slate-200'
      }`}
    >
      {label}
    </button>
  )
}
