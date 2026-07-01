import { useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useTabsStore } from '@/store/tabsStore'

/** Barre de saisie d'URL unifiée (Omnibox). Enter → navigue l'onglet actif (ou en crée un). */
export function Omnibox(): React.JSX.Element {
  const activeId = useTabsStore((s) => s.activeTabId)
  const activeUrl = useTabsStore((s) => (activeId ? s.tabs[activeId]?.url : '')) ?? ''
  const addTab = useTabsStore((s) => s.addTab)
  const [value, setValue] = useState('')

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

  return (
    <div className="app-no-drag px-3 pb-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-500" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          placeholder="Rechercher ou saisir une URL"
          spellCheck={false}
          className="h-8 rounded-lg border-white/10 bg-white/5 pl-8 text-sm text-slate-200 placeholder:text-slate-500 focus-visible:ring-primary/40"
        />
      </div>
    </div>
  )
}
