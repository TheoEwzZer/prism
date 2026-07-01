import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Lock, Globe, RotateCw, ExternalLink, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SiteControlPayload } from '@shared/types'

/**
 * Contenu des « Contrôles du site », rendu dans la fenêtre-overlay native transparente.
 * Récupère ses données via IPC, s'auto-dimensionne à son contenu, et se ferme sur action
 * ou Échap (la perte de focus est gérée côté Main).
 */
export function SiteControlOverlay(): React.JSX.Element | null {
  const [data, setData] = useState<SiteControlPayload | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.prism.getOverlayData().then(setData)
  }, [])

  // Ajuste la fenêtre à la hauteur réelle du panneau.
  useLayoutEffect(() => {
    if (!data || !ref.current) return
    window.prism.resizeOverlay({ width: 300, height: ref.current.offsetHeight })
  }, [data])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.prism.closeOverlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!data) return null

  const { url, activeId } = data
  const secure = /^https:/i.test(url)
  let host = ''
  try {
    host = url ? new URL(url).host : ''
  } catch {
    host = ''
  }

  const close = (): void => window.prism.closeOverlay()

  return (
    <div
      ref={ref}
      className="w-[300px] overflow-hidden rounded-xl border border-white/10 bg-popover text-slate-200 shadow-2xl shadow-black/60"
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
