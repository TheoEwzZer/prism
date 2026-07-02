import { useEffect, useRef, useState } from 'react'
import { Globe, ArrowRight, Search } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { useTabsStore } from '@/store/tabsStore'
import type { CommandPalettePayload } from '@shared/types'

/**
 * Palette de commande (façon Arc), rendue DANS la couche d'overlay native (au-dessus de la page).
 * Ouverte via Ctrl+T, clic sur l'URL, ou « Nouvel onglet ». Elle liste les onglets ouverts
 * (« Switch to Tab ») et permet de saisir une URL / recherche (Entrée).
 *
 * `data-overlay-hit="command"` marque la zone interactive pour le hit-test de la couche. La
 * fermeture (clic extérieur / Échap) est gérée par <OverlayLayer>.
 */
export function CommandPalette({ data }: { data: CommandPalettePayload }): React.JSX.Element {
  const { mode, activeId } = data
  const order = useTabsStore((s) => s.order)
  const tabs = useTabsStore.getState().tabs
  const [query, setQuery] = useState(data.initialQuery ?? '')
  const rootRef = useRef<HTMLDivElement>(null)

  // Champ pré-rempli (clic sur l'URL) : on sélectionne tout le texte au montage pour taper par
  // dessus directement (façon Arc). Le CommandInput shadcn ne forwarde pas de ref → on cible son
  // <input> via le data-slot dans notre conteneur.
  useEffect(() => {
    if (!data.initialQuery) return
    const input = rootRef.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]')
    input?.select()
  }, [data.initialQuery])

  const close = (): void => window.prism.closeCommandPalette()

  // Saisie URL / recherche → navigue l'onglet courant (clic URL) ou crée un onglet (Ctrl+T…).
  const submit = (raw: string): void => {
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

  const q = query.trim().toLowerCase()
  const openTabs = order
    .map((id) => tabs[id])
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .filter((t) => (activeId ? t.id !== activeId : true))
    .filter((t) => !q || t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))

  const isUrlish = /^https?:\/\//i.test(query) || /^[\w-]+(\.[\w-]+)+/.test(query.trim())

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
        <CommandList className="max-h-[360px]">
          <CommandEmpty className="py-6 text-center text-sm text-slate-500">
            Aucun onglet correspondant.
          </CommandEmpty>

          {q && (
            <CommandGroup>
              <CommandItem
                value={`__submit__${query}`}
                onSelect={() => submit(query)}
                className="gap-2.5"
              >
                <Search className="size-4 text-slate-400" />
                <span className="truncate">
                  {isUrlish ? 'Ouvrir' : 'Rechercher'} «&nbsp;{query}&nbsp;»
                </span>
              </CommandItem>
            </CommandGroup>
          )}

          {openTabs.length > 0 && (
            <CommandGroup heading="Onglets ouverts">
              {openTabs.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`tab:${t.id}:${t.title} ${t.url}`}
                  onSelect={() => switchTo(t.id)}
                  className="gap-2.5"
                >
                  {t.favicon ? (
                    <img src={t.favicon} alt="" className="size-4 shrink-0 rounded-sm" />
                  ) : (
                    <Globe className="size-4 shrink-0 text-slate-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{t.title || t.url || 'Onglet'}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-slate-500">
                    Switch to Tab
                    <ArrowRight className="size-3.5" />
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  )
}
