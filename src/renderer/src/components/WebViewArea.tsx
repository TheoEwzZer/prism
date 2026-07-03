import { useTabsStore } from '@/store/tabsStore'
import { Compass } from 'lucide-react'
import { isInternalUrl, HISTORY_URL, VIEW_INSET, VIEW_RADIUS, SPLIT_TOOLBAR_HEIGHT } from '@shared/types'
import { HistoryPage } from './HistoryPage'

/**
 * Zone de rendu web (droite). Pour un onglet « normal », c'est un simple placeholder visuel : la
 * WebContentsView native est peinte PAR-DESSUS ce DOM par Electron, à des bounds calculés côté Main.
 *
 * Pour un onglet « interne » (`prism://…`), il n'y a PAS de vue native (le Main la masque) : on rend
 * ici, en DOM React, la page correspondante (ex. Historique). C'est cohérent avec le principe
 * fondateur — une page interne est du pur UI state, donc rendue par le Renderer.
 *
 * L'état vide n'est visible que lorsqu'aucune vue native ne recouvre la zone (aucun onglet actif,
 * ou onglet hiberné pas encore réveillé).
 */
export function WebViewArea(): React.JSX.Element {
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const tabs = useTabsStore((s) => s.tabs)
  const splits = useTabsStore((s) => s.splits)

  const activeSplit = splits.find(s => activeTabId && s.tabIds.includes(activeTabId))

  // --- Gestion du mode Vue Divisée (Split) ---
  if (activeSplit) {
    const [idA, idB] = activeSplit.tabIds
    const urlA = tabs[idA]?.url
    const urlB = tabs[idB]?.url
    const isInternalA = urlA && isInternalUrl(urlA)
    const isInternalB = urlB && isInternalUrl(urlB)

    // Si aucune des deux n'est interne, rien à rendre de particulier (les vues natives s'en occupent)
    if (!isInternalA && !isInternalB) {
      return <main className="relative min-w-0 flex-1 bg-sidebar" />
    }

    return (
      <main 
        className="relative min-w-0 flex-1 bg-sidebar flex"
        style={{
          padding: `0 ${VIEW_INSET}px ${VIEW_INSET}px ${VIEW_INSET}px`,
          flexDirection: activeSplit.orientation === 'horizontal' ? 'row' : 'column',
          gap: `${VIEW_INSET}px`
        }}
      >
        <SplitPane url={urlA} isInternal={!!isInternalA} />
        <SplitPane url={urlB} isInternal={!!isInternalB} />
      </main>
    )
  }

  // --- Gestion du mode Plein Écran Normal ---
  const activeUrl = activeTabId ? (tabs[activeTabId]?.url ?? null) : null
  const internal = activeUrl !== null && isInternalUrl(activeUrl)

  return (
    <main className="relative min-w-0 flex-1 bg-sidebar">
      {internal && (
        <div 
          className="absolute inset-0 overflow-hidden"
          style={{
            top: 0,
            left: VIEW_INSET,
            right: VIEW_INSET,
            bottom: VIEW_INSET,
            borderRadius: VIEW_RADIUS,
            // Applique un bg pour cacher le background-sidebar si la page interne n'en a pas
            backgroundColor: 'var(--background, #fff)'
          }}
        >
          {renderInternalPage(activeUrl!)}
        </div>
      )}
      {activeUrl === null && (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
          <Compass className="size-10" />
          <p className="text-sm">Saisissez une adresse pour commencer à naviguer</p>
        </div>
      )}
    </main>
  )
}

function SplitPane({ url, isInternal }: { url?: string; isInternal: boolean }): React.JSX.Element {
  return (
    <div className="flex-1 relative flex flex-col min-w-0 min-h-0">
      <div style={{ height: SPLIT_TOOLBAR_HEIGHT, flexShrink: 0 }} />
      <div 
        className="flex-1 min-h-0 relative overflow-hidden" 
        style={{ 
          borderRadius: VIEW_RADIUS,
          backgroundColor: isInternal ? 'var(--background, #fff)' : 'transparent'
        }}
      >
        {isInternal && url && renderInternalPage(url)}
      </div>
    </div>
  )
}

/** Aiguille l'URL interne vers le composant de page correspondant. */
function renderInternalPage(url: string): React.JSX.Element | null {
  if (url.startsWith(HISTORY_URL)) return <HistoryPage />
  return null
}
