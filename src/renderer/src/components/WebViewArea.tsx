import { useTabsStore } from '@/store/tabsStore'
import { Compass } from 'lucide-react'
import { isInternalUrl, HISTORY_URL } from '@shared/types'
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
  const activeUrl = useTabsStore((s) =>
    s.activeTabId ? (s.tabs[s.activeTabId]?.url ?? null) : null
  )
  const internal = activeUrl !== null && isInternalUrl(activeUrl)

  return (
    <main className="relative min-w-0 flex-1 bg-sidebar">
      {internal && renderInternalPage(activeUrl!)}
      {activeUrl === null && (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
          <Compass className="size-10" />
          <p className="text-sm">Saisissez une adresse pour commencer à naviguer</p>
        </div>
      )}
    </main>
  )
}

/** Aiguille l'URL interne vers le composant de page correspondant. */
function renderInternalPage(url: string): React.JSX.Element | null {
  if (url.startsWith(HISTORY_URL)) return <HistoryPage />
  return null
}
