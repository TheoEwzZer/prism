import { memo } from 'react'
import { X, Globe, Loader2, Moon } from 'lucide-react'
import type { DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'

/**
 * Liaison drag & drop injectée par le wrapper sortable (`SortableTab`). Optionnelle : les
 * enfants de dossiers rendent un `TabItem` sans drag.
 */
export interface TabDragBind {
  setNodeRef: (el: HTMLElement | null) => void
  attributes: DraggableAttributes
  listeners: SyntheticListenerMap | undefined
  style: React.CSSProperties
  isDragging: boolean
}

/**
 * Un onglet vertical de la sidebar.
 *
 * Perf : abonnements par CHAMP atomique (title/favicon/isLoading/isActive). Un patch favicon
 * ne re-render que l'icône ; réordonner la liste (`order`) ne re-render aucun `TabItem`.
 * Mémoïsé pour ignorer les re-renders du parent qui ne changent pas la prop `id`.
 */
export const TabItem = memo(function TabItem({
  id,
  drag
}: {
  id: string
  drag?: TabDragBind
}): React.JSX.Element | null {
  const title = useTabsStore((s) => s.tabs[id]?.title)
  const favicon = useTabsStore((s) => s.tabs[id]?.favicon)
  const isLoading = useTabsStore((s) => s.tabs[id]?.isLoading)
  const isHibernated = useTabsStore((s) => s.tabs[id]?.isHibernated)
  const isActive = useTabsStore((s) => s.activeTabId === id)

  const setActive = useTabsStore((s) => s.setActive)
  const removeTab = useTabsStore((s) => s.removeTab)

  // Onglet retiré du store entre-temps.
  if (title === undefined) return null

  const activate = (): void => {
    setActive(id)
    window.prism.activateTab(id)
  }

  const doClose = (): void => {
    window.prism.closeTab(id)
    removeTab(id)
  }

  const close = (e: React.MouseEvent): void => {
    e.stopPropagation()
    doClose()
  }

  // Clic molette (bouton du milieu) = fermer l'onglet, façon Arc. `auxclick` ne se déclenche que
  // pour les boutons non primaires ; on filtre le bouton 1 (molette).
  const onAuxClose = (e: React.MouseEvent): void => {
    if (e.button !== 1) return
    e.preventDefault()
    e.stopPropagation()
    doClose()
  }

  // Neutralise l'autoscroll natif du bouton du milieu (déclenché au mousedown) sur cet onglet.
  const onMiddleMouseDown = (e: React.MouseEvent): void => {
    if (e.button === 1) e.preventDefault()
  }

  return (
    <div
      ref={drag?.setNodeRef}
      style={drag?.style}
      onClick={activate}
      onAuxClick={onAuxClose}
      onMouseDown={onMiddleMouseDown}
      {...drag?.attributes}
      {...drag?.listeners}
      className={cn(
        'group relative flex h-8 cursor-default items-center gap-2 rounded-lg pl-2 pr-2 text-sm',
        'transition-colors',
        isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5',
        drag?.isDragging && 'opacity-40'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {isLoading ? (
          <Loader2 className="size-3.5 animate-spin text-slate-400" />
        ) : favicon ? (
          <img src={favicon} alt="" className="size-4 rounded-sm" />
        ) : (
          <Globe className="size-3.5 text-slate-500" />
        )}
      </span>

      {/* `min-w-0` : indispensable pour que `truncate` puisse rétrécir sous la taille du texte. Au
          survol, on réserve à droite la place de la croix (`pr-6`) → le nom raccourcit et affiche `…`
          au lieu de passer sous la croix. */}
      <span
        className={cn('min-w-0 flex-1 truncate group-hover:pr-6', isHibernated && 'opacity-60')}
      >
        {title || 'Nouvel onglet'}
      </span>

      {/* Lune d'hibernation : cachée au survol (la croix occupe alors ce coin droit). */}
      {isHibernated && (
        <Moon className="size-3 shrink-0 text-slate-500 transition-opacity group-hover:opacity-0" />
      )}

      {/* Croix en overlay (absolue) : toujours entièrement visible au survol, calée à droite, par
          DESSUS l'onglet — sa taille ne dépend jamais de la longueur du nom ni de la sidebar. */}
      <button
        aria-label="Fermer l'onglet"
        onClick={close}
        // Empêche le drag de démarrer quand on clique la croix (le pointer-down remonterait
        // sinon aux listeners du row et lancerait un tri).
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded',
          'text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/15'
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
})
