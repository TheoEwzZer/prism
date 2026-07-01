import { useEffect, useState } from 'react'
import { Lock, Globe, RotateCw, ExternalLink, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SiteControlPayload } from '@shared/types'

const PANEL_WIDTH = 300

/**
 * Popover « Contrôles du site », rendu DANS la couche d'overlay unique et positionné en
 * coordonnées client (l'overlay est calé 1:1 sur la fenêtre principale) — aligné à droite sous
 * le bouton ancre. `data-overlay-hit="site"` marque la zone interactive pour le hit-test.
 * La fermeture (clic extérieur / Échap) est gérée par la couche.
 */
export function SiteControlPopover({ data }: { data: SiteControlPayload }): React.JSX.Element {
  const { url, activeId, anchorRight, anchorBottom } = data

  // Petite animation d'entrée (opacité + échelle).
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(r)
  }, [])

  const secure = /^https:/i.test(url)
  let host = ''
  try {
    host = url ? new URL(url).host : ''
  } catch {
    host = ''
  }

  const close = (): void => window.prism.closeSiteControl()

  return (
    <div
      data-overlay-hit="site"
      style={{ top: anchorBottom + 6, left: anchorRight - PANEL_WIDTH, width: PANEL_WIDTH }}
      className={cn(
        'pointer-events-auto absolute origin-top-right overflow-hidden rounded-xl border',
        'border-white/10 bg-popover text-slate-200 shadow-2xl shadow-black/60',
        'transition-all duration-150 ease-out',
        shown ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        {secure ? (
          <Lock className="size-4 shrink-0 text-emerald-400" />
        ) : (
          <Globe className="size-4 shrink-0 text-slate-400" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{host || 'Aucune page'}</p>
          <p className="text-xs text-slate-500">
            {secure ? 'Connexion sécurisée' : url ? 'Connexion non sécurisée' : '—'}
          </p>
        </div>
      </div>
      <div className="flex flex-col p-1">
        <Row
          icon={<RotateCw className="size-4" />}
          label="Rafraîchir la page"
          disabled={!activeId}
          onClick={() => {
            if (activeId) window.prism.reload(activeId)
            close()
          }}
        />
        <Row
          icon={<ExternalLink className="size-4" />}
          label="Ouvrir dans le navigateur système"
          disabled={!url}
          onClick={() => {
            if (url) window.prism.openExternal(url)
            close()
          }}
        />
        <Row
          icon={<Copy className="size-4" />}
          label="Copier l'adresse"
          disabled={!url}
          onClick={() => {
            if (url) window.prism.copyText(url)
            close()
          }}
        />
      </div>
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
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        'hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40'
      )}
    >
      <span className="text-slate-400">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
