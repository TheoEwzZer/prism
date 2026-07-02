import { useEffect, useRef, useState } from 'react'
import { Globe, ArrowRight, Search, X } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { useTabsStore } from '@/store/tabsStore'
import type { CommandPalettePayload, HistoryEntry, TabState } from '@shared/types'

const SUGGEST_DEBOUNCE_MS = 150

/** Ressemble à une URL / un domaine (vs une recherche) ? */
function isUrlish(s: string): boolean {
  const t = s.trim()
  return /^https?:\/\//i.test(t) || (/^[^\s]+\.[^\s]+$/.test(t) && !t.includes(' '))
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

/**
 * Palette de commande « complète » façon Arc, rendue DANS la couche d'overlay native. Selon la
 * saisie, elle fusionne et classe : (1) l'action sur la requête, (2) les onglets ouverts,
 * (3) l'historique local (frecency), (4) les suggestions Google. Champ vide → onglets + récents.
 *
 * `data-overlay-hit="command"` marque la zone interactive pour le hit-test. Fermeture (clic
 * extérieur / Échap) gérée par <OverlayLayer>. `shouldFilter={false}` : classement fait main,
 * cmdk ne gère que la sélection clavier (1er item rendu = présélectionné).
 */
export function CommandPalette({ data }: { data: CommandPalettePayload }): React.JSX.Element {
  const { mode, activeId } = data
  const order = useTabsStore((s) => s.order)
  const tabs = useTabsStore.getState().tabs
  const [query, setQuery] = useState(data.initialQuery ?? '')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  // Champ pré-rempli (clic sur l'URL) : sélectionne tout au montage pour taper par-dessus.
  useEffect(() => {
    if (!data.initialQuery) return
    const input = rootRef.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]')
    input?.select()
  }, [data.initialQuery])

  // Historique + suggestions, débouncés, avec annulation des réponses périmées (reqId).
  const reqId = useRef(0)
  useEffect(() => {
    const id = ++reqId.current
    const q = query.trim()
    const t = setTimeout(() => {
      window.prism.searchHistory(q, q ? 5 : 6).then((h) => {
        if (id === reqId.current) setHistory(h)
      })
      if (q) {
        window.prism.getSuggestions(q).then((s) => {
          if (id === reqId.current) setSuggestions(s)
        })
      } else {
        setSuggestions([])
      }
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const close = (): void => window.prism.closeCommandPalette()

  // Saisie d'URL/recherche (ou item d'historique) → onglet courant (clic URL) ou nouvel onglet.
  const openInput = (raw: string): void => {
    const input = raw.trim()
    if (!input) return
    if (mode === 'currentTab' && activeId) window.prism.navigate(activeId, input)
    else window.prism.createTab({ url: input })
    close()
  }

  const switchTo = (id: string): void => {
    window.prism.activateTab(id)
    close()
  }

  const removeHistory = (url: string): void => {
    window.prism.removeHistory(url)
    setHistory((h) => h.filter((e) => e.url !== url))
  }

  const q = query.trim().toLowerCase()
  const openTabs: TabState[] = order
    .map((id) => tabs[id])
    .filter((t): t is TabState => Boolean(t))
    .filter((t) => (activeId ? t.id !== activeId : true))
    .filter((t) => !q || t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
    .slice(0, q ? 4 : 8)

  // Dédup : masque l'historique déjà présent en onglet ouvert, et la suggestion == requête.
  const openUrls = new Set(openTabs.map((t) => t.url))
  const historyRows = history.filter((e) => !openUrls.has(e.url))
  const suggestionRows = suggestions.filter((s) => s.toLowerCase() !== q).slice(0, 5)

  return (
    <div
      ref={rootRef}
      data-overlay-hit="command"
      className="pointer-events-auto absolute top-20 left-1/2 w-[640px] max-w-[90%] -translate-x-1/2"
    >
      <Command
        shouldFilter={false}
        loop
        className="overflow-hidden rounded-xl border border-white/10 bg-popover text-slate-200 shadow-2xl shadow-black/60"
      >
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Rechercher ou saisir une URL…"
        />
        <CommandList className="max-h-[420px]">
          <CommandEmpty className="py-6 text-center text-sm text-slate-500">
            Aucun résultat.
          </CommandEmpty>

          {/* 1. Action sur la requête (toujours en tête, présélectionnée). */}
          {q && (
            <CommandGroup>
              <CommandItem
                value={`__submit__${query}`}
                onSelect={() => openInput(query)}
                className="gap-2.5"
              >
                <Search className="size-4 text-slate-400" />
                <span className="truncate">
                  {isUrlish(query) ? 'Ouvrir' : 'Rechercher'} «&nbsp;{query}&nbsp;»
                </span>
              </CommandItem>
            </CommandGroup>
          )}

          {/* 2. Onglets ouverts. */}
          {openTabs.length > 0 && (
            <CommandGroup heading="Onglets ouverts">
              {openTabs.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`tab:${t.id}`}
                  onSelect={() => switchTo(t.id)}
                  className="gap-2.5"
                >
                  <Favicon favicon={t.favicon} />
                  <span className="min-w-0 flex-1 truncate">{t.title || t.url || 'Onglet'}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-slate-500">
                    Switch to Tab
                    <ArrowRight className="size-3.5" />
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* 3. Historique (frecency), avec suppression. */}
          {historyRows.length > 0 && (
            <CommandGroup heading={q ? 'Historique' : 'Récent'}>
              {historyRows.map((e) => (
                <CommandItem
                  key={e.url}
                  value={`hist:${e.url}`}
                  onSelect={() => openInput(e.url)}
                  className="group gap-2.5"
                >
                  <Favicon favicon={e.favicon} />
                  <span className="min-w-0 shrink truncate font-medium">{e.title || e.url}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                    {prettyUrl(e.url)}
                  </span>
                  <button
                    aria-label="Retirer de l'historique"
                    title="Retirer de l'historique"
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      ev.preventDefault()
                      removeHistory(e.url)
                    }}
                    className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white"
                  >
                    <X className="size-3.5" />
                  </button>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* 4. Suggestions de recherche (Google). */}
          {suggestionRows.length > 0 && (
            <CommandGroup heading="Suggestions">
              {suggestionRows.map((s) => (
                <CommandItem
                  key={`sug:${s}`}
                  value={`sug:${s}`}
                  onSelect={() => openInput(s)}
                  className="gap-2.5"
                >
                  <Search className="size-4 shrink-0 text-slate-400" />
                  <span className="truncate">{s}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  )
}

function Favicon({ favicon }: { favicon: string | null }): React.JSX.Element {
  return favicon ? (
    <img src={favicon} alt="" className="size-4 shrink-0 rounded-sm" />
  ) : (
    <Globe className="size-4 shrink-0 text-slate-400" />
  )
}
