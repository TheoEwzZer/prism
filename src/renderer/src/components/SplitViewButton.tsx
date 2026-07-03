import { useRef } from 'react'
import { Columns2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'

// Largeur du menu (cf. MENU_WIDTH de SplitMenu) pour aligner son bord droit sous le bouton.
const MENU_WIDTH = 236

/**
 * Bouton « Options de vue divisée » de la TopBar. Le menu lui-même vit dans la couche d'overlay
 * (au-dessus de la vue web native) — cf. {@link SplitMenu}. Ce bouton ne fait qu'ouvrir/fermer le
 * menu (toggle côté Main) en lui passant les coordonnées client du coin sous le bouton.
 *
 * Désactivé si aucun onglet actif, ou si l'onglet actif est déjà membre d'une division (MVP :
 * pas de division imbriquée).
 */
export function SplitViewButton(): React.JSX.Element {
  const activeId = useTabsStore((s) => s.activeTabId)
  const inSplit = useTabsStore((s) =>
    activeId ? s.splits.some((sp) => sp.tabIds.includes(activeId)) : false
  )
  const ref = useRef<HTMLButtonElement>(null)

  const disabled = !activeId || inSplit

  const open = (): void => {
    if (disabled) return
    const r = ref.current?.getBoundingClientRect()
    // Aligne le bord droit du menu sur le bord droit du bouton, juste en dessous.
    const x = r ? Math.round(r.right - MENU_WIDTH) : 0
    const y = r ? Math.round(r.bottom + 4) : 0
    window.prism.openSplitMenu({ x, y, activeId })
  }

  return (
    <button
      ref={ref}
      aria-label="Options de vue divisée"
      title="Options de vue divisée"
      onClick={open}
      disabled={disabled}
      className={cn(
        'app-no-drag pointer-events-auto flex size-6 items-center justify-center rounded-md transition-colors',
        'text-slate-400 hover:bg-white/10 hover:text-white',
        'disabled:pointer-events-none disabled:opacity-30'
      )}
    >
      <Columns2 className="size-4" />
    </button>
  )
}
