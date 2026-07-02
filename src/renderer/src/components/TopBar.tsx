import { Settings, PanelLeft, ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
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
    <div className="app-drag relative flex h-8 shrink-0 items-center border-b border-white/5 bg-sidebar">
      {/* Omnibox centrée sur la largeur totale de la fenêtre (pas sur la zone web), pour rester
          visuellement au milieu quelle que soit la largeur de la sidebar. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <div className="app-no-drag pointer-events-auto flex max-w-[60%] justify-center">
          <Omnibox />
        </div>
      </div>

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

      {/* Zone droite — au-dessus de la zone web : URL centrée. Les boutons min/agrandir/fermer
          sont dessinés nativement par Windows (Window Controls Overlay, cf. index.ts) dans le
          coin haut-droit → ils déclenchent les Snap Layouts. On réserve leur largeur à droite. */}
      <div className="pointer-events-none relative flex h-full flex-1 items-center px-2" />
    </div>
  )
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
  active
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-6 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-primary/20 text-primary hover:bg-primary/30'
          : 'text-slate-400 hover:bg-white/10 hover:text-white',
        'disabled:pointer-events-none disabled:opacity-30'
      )}
    >
      {children}
    </button>
  )
}
