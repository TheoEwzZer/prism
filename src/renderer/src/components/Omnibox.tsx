import { useRef, useState } from 'react'
import { Copy, Check, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'

/**
 * Barre d'URL de la TopBar. Ce n'est PAS un champ éditable : cliquer dessus ouvre la palette de
 * commande (façon Arc, dans la couche d'overlay native) en mode `currentTab` — la saisie/
 * navigation se fait là-bas. Encadrée du bouton copier (gauche) et Contrôles du site (droite).
 */
export function Omnibox(): React.JSX.Element {
  const activeId = useTabsStore((s) => s.activeTabId)
  const activeUrl = useTabsStore((s) => (activeId ? s.tabs[activeId]?.url : '')) ?? ''
  const [copied, setCopied] = useState(false)
  const scRef = useRef<HTMLButtonElement>(null)

  const copyUrl = (): void => {
    if (!activeUrl) return
    window.prism.copyText(activeUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  // Clic sur l'URL → palette de commande (mode onglet courant), pré-remplie avec l'URL actuelle.
  const openPalette = (): void => {
    window.prism.openCommandPalette({ mode: 'currentTab', activeId, initialQuery: activeUrl })
  }

  // Ouvre les « Contrôles du site » dans la couche d'overlay native (au-dessus de la page).
  const openSiteControl = (): void => {
    const el = scRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    window.prism.openSiteControl({
      url: activeUrl,
      activeId,
      anchorRight: r.right,
      anchorBottom: r.bottom
    })
  }

  let display = ''
  try {
    display = activeUrl
      ? new URL(activeUrl).host + new URL(activeUrl).pathname.replace(/\/$/, '')
      : ''
  } catch {
    display = activeUrl
  }

  return (
    <div className="flex items-center gap-0.5">
      {/* Bouton gauche : copier l'URL. */}
      <button
        aria-label="Copier l'adresse"
        title="Copier l'adresse"
        onClick={copyUrl}
        disabled={!activeUrl}
        className="flex size-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
      >
        {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>

      {/* Zone URL cliquable (ouvre la palette). La pilule s'ajuste à son contenu (max-w) pour
          que les boutons restent collés au texte. */}
      <button
        onClick={openPalette}
        title="Rechercher ou saisir une URL"
        className={cn(
          'flex h-7 min-w-0 max-w-[360px] items-center justify-center rounded-md border border-transparent px-3',
          'bg-white/5 text-sm transition-colors hover:bg-white/[0.07]',
          display ? 'text-slate-200' : 'text-slate-500'
        )}
      >
        <span className="truncate">{display || 'Rechercher ou saisir une URL'}</span>
      </button>

      {/* Bouton droite : Contrôles du site (couche d'overlay native). */}
      <button
        ref={scRef}
        aria-label="Contrôles du site"
        title="Contrôles du site"
        onClick={openSiteControl}
        className="flex size-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <SlidersHorizontal className="size-3.5" />
      </button>
    </div>
  )
}
