import { useEffect, useState } from 'react'
import {
  Settings,
  PanelLeft,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Minus,
  Square,
  Copy,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'
import { Omnibox } from './Omnibox'

/**
 * Barre supérieure pleine largeur (façon Arc). Emplacements :
 *  - haut-gauche : paramètres + toggle sidebar, puis retour / suivant / reload
 *    (alignés au bord droit de la sidebar quand elle est ouverte) ;
 *  - centre (au-dessus de la zone web) : l'URL (Omnibox) ;
 *  - haut-droite : contrôles fenêtre (réduire / agrandir / fermer).
 *
 * Toute la barre est une zone de drag (`app-drag`) ; les boutons/champ sont `app-no-drag`.
 */
export function TopBar(): React.JSX.Element {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)
  const setCollapsed = useTabsStore((s) => s.setSidebarCollapsed)

  const activeId = useTabsStore((s) => s.activeTabId)
  const canGoBack = useTabsStore((s) => (activeId ? s.tabs[activeId]?.canGoBack : false))
  const canGoForward = useTabsStore((s) => (activeId ? s.tabs[activeId]?.canGoForward : false))

  const nav = (
    <>
      <IconButton
        label="Précédent"
        disabled={!canGoBack}
        onClick={() => activeId && window.prism.goBack(activeId)}
      >
        <ArrowLeft className="size-4" />
      </IconButton>
      <IconButton
        label="Suivant"
        disabled={!canGoForward}
        onClick={() => activeId && window.prism.goForward(activeId)}
      >
        <ArrowRight className="size-4" />
      </IconButton>
      <IconButton
        label="Rafraîchir"
        disabled={!activeId}
        onClick={() => activeId && window.prism.reload(activeId)}
      >
        <RotateCw className="size-4" />
      </IconButton>
    </>
  )

  return (
    <div className="app-drag relative flex h-11 shrink-0 items-center border-b border-white/5 bg-sidebar">
      {/* Zone gauche. Ouverte : largeur = sidebar, nav collée au bord droit. Repliée : cluster
          compact auto (pas d'espace vide), avec la nav toujours visible. */}
      {collapsed ? (
        <div className="app-no-drag flex h-full items-center gap-0.5 px-2">
          <IconButton label="Paramètres">
            <Settings className="size-4" />
          </IconButton>
          <IconButton label="Déplier la barre latérale" onClick={() => setCollapsed(false)}>
            <PanelLeft className="size-4" />
          </IconButton>
          {nav}
        </div>
      ) : (
        <div
          style={{ width }}
          className="app-no-drag flex h-full shrink-0 items-center gap-0.5 px-2"
        >
          <IconButton label="Paramètres">
            <Settings className="size-4" />
          </IconButton>
          <IconButton label="Replier la barre latérale" onClick={() => setCollapsed(true)}>
            <PanelLeft className="size-4" />
          </IconButton>
          <div className="flex-1" />
          {nav}
        </div>
      )}

      {/* Zone droite — au-dessus de la zone web : URL centrée + contrôles fenêtre. */}
      <div className="relative flex h-full flex-1 items-center px-2">
        <div className="flex-1" />
        <WindowControls />

        {/* Omnibox centrée sur la zone web. */}
        <div className="app-no-drag absolute left-1/2 w-[420px] max-w-[42%] -translate-x-1/2">
          <Omnibox />
        </div>
      </div>
    </div>
  )
}

function WindowControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => window.prism.onWindowState((s) => setMaximized(s.isMaximized)), [])

  return (
    <div className="app-no-drag flex items-center gap-0.5">
      <WindowButton label="Réduire" onClick={() => window.prism.minimizeWindow()}>
        <Minus className="size-3.5" />
      </WindowButton>
      <WindowButton label="Agrandir" onClick={() => window.prism.toggleMaximizeWindow()}>
        {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
      </WindowButton>
      <WindowButton label="Fermer" danger onClick={() => window.prism.closeWindow()}>
        <X className="size-3.5" />
      </WindowButton>
    </div>
  )
}

function IconButton({
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
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors',
        'hover:bg-white/10 hover:text-white',
        'disabled:pointer-events-none disabled:opacity-30'
      )}
    >
      {children}
    </button>
  )
}

function WindowButton({
  children,
  onClick,
  label,
  danger
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors',
        danger ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-white/10 hover:text-white'
      )}
    >
      {children}
    </button>
  )
}
