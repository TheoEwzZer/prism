import { useTabsStore } from '@/store/tabsStore'
import { Compass } from 'lucide-react'

/**
 * Zone de rendu web (droite). C'est un simple placeholder visuel : la WebContentsView native
 * est peinte PAR-DESSUS ce DOM par Electron, à des bounds calculés côté Main. On n'y mesure
 * ni n'y positionne rien (le Main est la source de vérité du layout).
 *
 * L'état vide n'est visible que lorsqu'aucune vue native ne recouvre la zone (aucun onglet
 * actif, ou onglet hiberné pas encore réveillé).
 */
export function WebViewArea(): React.JSX.Element {
  const hasActive = useTabsStore((s) => s.activeTabId !== null)

  return (
    <main className="relative min-w-0 flex-1 bg-black">
      {!hasActive && (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
          <Compass className="size-10" />
          <p className="text-sm">Saisissez une adresse pour commencer à naviguer</p>
        </div>
      )}
    </main>
  )
}
