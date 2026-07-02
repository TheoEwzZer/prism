import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Moon, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'
import type { TabMenuPayload } from '@shared/types'

const MENU_WIDTH = 190

/**
 * Menu contextuel d'un onglet (clic droit), rendu DANS la couche d'overlay unique → il flotte
 * AU-DESSUS de la `WebContentsView` native (impossible depuis la fenêtre principale, dont le DOM
 * passe derrière la vue). Positionné en coordonnées client (overlay calé 1:1 sur la principale).
 *
 * `data-overlay-hit="tabmenu"` marque la zone interactive pour le hit-test de la couche. La
 * fermeture (clic extérieur / Échap) est gérée par la couche.
 */
export function TabContextMenu({ data }: { data: TabMenuPayload }): React.JSX.Element {
  const { tabId, url, isHibernated, x, y } = data
  const title = useTabsStore((s) => s.tabs[tabId]?.title)
  const customTitle = useTabsStore((s) => s.tabs[tabId]?.customTitle)

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // Position clampée dans le viewport (le clic peut être près d'un bord).
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - width - 8)
    const top = Math.min(y, window.innerHeight - height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y, renaming])

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  const close = (): void => window.prism.closeTabMenu()

  const copyUrl = (): void => {
    if (url) window.prism.copyText(url)
    close()
  }
  const hibernate = (): void => {
    window.prism.hibernateTab(tabId)
    close()
  }
  const startRename = (): void => {
    setDraft(customTitle || title || '')
    setRenaming(true)
  }
  const commitRename = (): void => {
    const next = draft.trim() ? draft.trim() : null
    window.prism.renameTab(tabId, next)
    close()
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Échap est aussi géré par la couche (fermeture) ; on stoppe pour éviter le double effet.
    if (e.key === 'Enter') {
      e.stopPropagation()
      commitRename()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }

  return (
    <div
      ref={rootRef}
      data-overlay-hit="tabmenu"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className={cn(
        'pointer-events-auto absolute overflow-hidden rounded-lg border border-white/10',
        'bg-popover p-1 text-slate-200 shadow-2xl shadow-black/60'
      )}
    >
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commitRename}
          placeholder="Nom de l'onglet"
          className="w-full rounded-md bg-white/10 px-2 py-1.5 text-sm text-white outline-none ring-1 ring-white/20"
        />
      ) : (
        <>
          <Row
            icon={<Copy className="size-4" />}
            label="Copier l'URL"
            disabled={!url}
            onClick={copyUrl}
          />
          <Row
            icon={<Moon className="size-4" />}
            label="Mettre en hibernation"
            disabled={isHibernated}
            onClick={hibernate}
          />
          <Row icon={<Pencil className="size-4" />} label="Renommer" onClick={startRename} />
        </>
      )}
    </div>
  )
}

function Row({
  icon,
  label,
  onClick,
  disabled
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        'hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40'
      )}
    >
      <span className="text-slate-400">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
