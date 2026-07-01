import { useRef, useState } from 'react'
import { Copy, Check, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useTabsStore } from '@/store/tabsStore'

/** Barre de saisie d'URL unifiée (Omnibox). Enter → navigue l'onglet actif (ou en crée un). */
export function Omnibox(): React.JSX.Element {
  const activeId = useTabsStore((s) => s.activeTabId)
  const activeUrl = useTabsStore((s) => (activeId ? s.tabs[activeId]?.url : '')) ?? ''
  const addTab = useTabsStore((s) => s.addTab)
  const [value, setValue] = useState('')
  const [copied, setCopied] = useState(false)
  const scRef = useRef<HTMLButtonElement>(null)

  // Ajustement d'état pendant le rendu (pattern recommandé, sans effet) : on resynchronise
  // l'affichage sur l'URL de l'onglet actif quand celui-ci change ou navigue.
  const [synced, setSynced] = useState<{ id: string | null; url: string }>({ id: null, url: '' })
  if (synced.id !== activeId || synced.url !== activeUrl) {
    setSynced({ id: activeId, url: activeUrl })
    setValue(activeUrl)
  }

  const submit = async (): Promise<void> => {
    const input = value.trim()
    if (!input) return
    if (activeId) {
      window.prism.navigate(activeId, input)
    } else {
      const tab = await window.prism.createTab({ url: input })
      addTab(tab)
    }
  }

  const copyUrl = (): void => {
    if (!activeUrl) return
    window.prism.copyText(activeUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  // Ouvre les « Contrôles du site » dans une fenêtre-overlay native (au-dessus de la page).
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

  return (
    <div className="relative">
      {/* Bouton gauche : copier l'URL. */}
      <button
        aria-label="Copier l'adresse"
        title="Copier l'adresse"
        onClick={copyUrl}
        disabled={!activeUrl}
        className="absolute top-1/2 left-1 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
      >
        {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>

      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
        placeholder="Rechercher ou saisir une URL"
        spellCheck={false}
        className="h-7 rounded-md border-transparent bg-white/5 px-8 text-center text-sm text-slate-200 placeholder:text-slate-500 hover:bg-white/[0.07] focus-visible:border-white/10 focus-visible:bg-white/10 focus-visible:text-left focus-visible:ring-primary/30"
      />

      {/* Bouton droite : Contrôles du site (fenêtre-overlay native). */}
      <button
        ref={scRef}
        aria-label="Contrôles du site"
        title="Contrôles du site"
        onClick={openSiteControl}
        className="absolute top-1/2 right-1 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        <SlidersHorizontal className="size-3.5" />
      </button>
    </div>
  )
}
