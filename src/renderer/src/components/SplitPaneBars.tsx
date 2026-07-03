import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Globe, X, Columns2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'
import { splitPaneLayout, type SplitState, type LayoutRect } from '@shared/types'

/** Taille de fenêtre suivie pour recalculer les rects des barres au resize. */
function useWindowSize(): { w: number; h: number } {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const onResize = (): void => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/**
 * Barres d'outils par panneau d'une vue divisée (façon Arc) : chaque panneau a sa propre barre
 * (retour/suivant/recharger + omnibox éditable) dessinée dans le chrome React, positionnée dans la
 * bande AU-DESSUS de sa `WebContentsView` (la vue démarre plus bas, cf. `splitPaneLayout`) — donc
 * visible et cliquable (pas recouverte par la vue native).
 *
 * Seule la division contenant l'onglet actif est affichée (le Main ne peint qu'une division).
 */
export function SplitPaneBars(): React.JSX.Element | null {
  const splits = useTabsStore((s) => s.splits)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const sidebarWidth = useTabsStore((s) => s.sidebarWidth)
  const { w, h } = useWindowSize()

  const split = activeTabId ? splits.find((s) => s.tabIds.includes(activeTabId)) : undefined
  if (!split) return null

  const effectiveSidebar = collapsed ? 0 : sidebarWidth
  const panes = splitPaneLayout(w, h, effectiveSidebar, split.orientation)

  return (
    <>
      {split.tabIds.map((id, i) => (
        <PaneToolbar key={id} paneId={id} rect={panes[i].toolbar} split={split} />
      ))}
    </>
  )
}

function PaneToolbar({
  paneId,
  rect,
  split
}: {
  paneId: string
  rect: LayoutRect
  split: SplitState
}): React.JSX.Element | null {
  const url = useTabsStore((s) => s.tabs[paneId]?.url)
  const canGoBack = useTabsStore((s) => s.tabs[paneId]?.canGoBack)
  const canGoForward = useTabsStore((s) => s.tabs[paneId]?.canGoForward)
  const favicon = useTabsStore((s) => s.tabs[paneId]?.favicon)
  const isActive = useTabsStore((s) => s.activeTabId === paneId)

  // `draft` n'est utilisé que pendant l'édition ; hors édition, le champ affiche l'URL courante
  // (valeur dérivée) — pas d'effet de synchronisation draft↔url.
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  if (url === undefined) return null

  const focusPane = (): void => {
    if (isActive) return
    useTabsStore.getState().setActive(paneId)
    window.prism.activateSplit({
      orientation: split.orientation,
      tabIds: split.tabIds,
      focusedId: paneId
    })
  }

  const submit = (): void => {
    const value = draft.trim()
    if (value) window.prism.navigate(paneId, value)
    inputRef.current?.blur()
    setEditing(false)
  }

  // Ferme DÉFINITIVEMENT ce panneau : dissout la division (removeTab) ; l'autre onglet repasse en
  // plein écran (activateTab). L'onglet fermé est réellement supprimé (ne réapparaît pas dans la liste).
  const closePane = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const remaining = split.tabIds.find((id) => id !== paneId)
    window.prism.closeTab(paneId)
    useTabsStore.getState().removeTab(paneId)
    if (remaining) window.prism.activateTab(remaining)
  }

  // Ouvre le menu « Options de vue divisée » de CE panneau dans l'overlay (au-dessus de la vue).
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    window.prism.openPaneMenu({
      x: Math.round(r.left),
      y: Math.round(r.bottom + 4),
      splitId: split.id,
      paneId
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation()
    if (e.key === 'Enter') submit()
    else if (e.key === 'Escape') {
      setDraft(url ?? '')
      setEditing(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div
      onMouseDown={focusPane}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      className={cn(
        'app-no-drag absolute flex items-center gap-1 rounded-t-lg px-1.5',
        isActive ? 'bg-white/[0.07]' : 'bg-white/[0.03]'
      )}
    >
      <PaneButton
        label="Précédent"
        disabled={!canGoBack}
        onClick={() => window.prism.goBack(paneId)}
      >
        <ArrowLeft className="size-3.5" />
      </PaneButton>
      <PaneButton
        label="Suivant"
        disabled={!canGoForward}
        onClick={() => window.prism.goForward(paneId)}
      >
        <ArrowRight className="size-3.5" />
      </PaneButton>
      <PaneButton label="Rafraîchir" onClick={() => window.prism.reload(paneId)}>
        <RotateCw className="size-3.5" />
      </PaneButton>

      <span className="flex size-4 shrink-0 items-center justify-center">
        {favicon ? (
          <img src={favicon} alt="" className="size-4 rounded-sm" />
        ) : (
          <Globe className="size-3.5 text-slate-500" />
        )}
      </span>

      <input
        ref={inputRef}
        value={editing ? draft : (url ?? '')}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(url ?? '')
          setEditing(true)
          e.target.select()
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={onKeyDown}
        placeholder="Rechercher ou saisir une URL"
        className={cn(
          'h-6 min-w-0 flex-1 rounded-md border border-transparent bg-white/5 px-2 text-xs outline-none',
          'text-slate-200 placeholder:text-slate-500 focus:border-white/15 focus:bg-white/10'
        )}
      />

      <button
        aria-label="Options de vue divisée"
        title="Options de vue divisée"
        onClick={openMenu}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors',
          'hover:bg-white/10 hover:text-white'
        )}
      >
        <Columns2 className="size-3.5" />
      </button>

      <button
        aria-label="Fermer le panneau"
        title="Fermer le panneau"
        onClick={closePane}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors',
          'hover:bg-white/10 hover:text-white'
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function PaneButton({
  children,
  label,
  onClick,
  disabled
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors',
        'hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30'
      )}
    >
      {children}
    </button>
  )
}
