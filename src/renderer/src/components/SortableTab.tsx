import { useSortable } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'
import { TabItem } from './TabItem'
import type { DropZone } from './SidebarTabs'

/**
 * Onglet rendu dans une zone triable (favoris ou onglets actuels). Fournit à `TabItem` la
 * liaison drag & drop de dnd-kit. `data.zone` permet à l'orchestrateur (`SidebarTabs`) de savoir de
 * quelle zone provient l'élément survolé.
 *
 * En plus du tri, chaque onglet expose une zone droppable CENTRALE (`split:<id>`) : pendant un drag,
 * survoler le centre d'un autre onglet déclenche un aperçu de vue divisée (`previewOtherId`), et le
 * drop crée le split. Survoler les bords (haut/bas) reste du réordonnancement classique.
 */
export function SortableTab({
  id,
  zone,
  dragActive,
  previewOtherId
}: {
  id: string
  zone: DropZone
  /** Un drag est en cours (monte la zone droppable centrale de split). */
  dragActive?: boolean
  /** Si défini, CET onglet est la cible d'un aperçu de split avec cet autre onglet (le déposé). */
  previewOtherId?: string | null
}): React.JSX.Element {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    data: { zone }
  })
  const { setNodeRef: setSplitRef } = useDroppable({ id: `split:${id}`, data: { zone } })
  const style = { transform: CSS.Translate.toString(transform), transition }

  if (previewOtherId) {
    return (
      <div ref={setNodeRef} style={style}>
        <SplitPreviewPill firstId={id} secondId={previewOtherId} />
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <TabItem
        id={id}
        drag={{ setNodeRef: () => {}, attributes, listeners, style: {}, isDragging }}
      />
      {/* Zone centrale (moitié verticale) : cible du split. Détectée géométriquement par dnd-kit
          (pointer-events désactivés, la détection utilise le rect). Montée seulement en drag et pas
          sur l'onglet lui-même déplacé. */}
      {dragActive && !isDragging && (
        <div
          ref={setSplitRef}
          className="pointer-events-none absolute inset-x-0 top-1/4 bottom-1/4"
        />
      )}
    </div>
  )
}

/** Aperçu (preview) d'une future vue divisée dans la sidebar : deux moitiés, contour en pointillés. */
function SplitPreviewPill({
  firstId,
  secondId
}: {
  firstId: string
  secondId: string
}): React.JSX.Element {
  return (
    <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-dashed border-primary/60 bg-primary/10">
      <PreviewHalf id={firstId} />
      <div className="my-1 w-px shrink-0 bg-white/15" />
      <PreviewHalf id={secondId} />
    </div>
  )
}

function PreviewHalf({ id }: { id: string }): React.JSX.Element {
  const title = useTabsStore((s) => s.tabs[id]?.title)
  const customTitle = useTabsStore((s) => s.tabs[id]?.customTitle)
  const favicon = useTabsStore((s) => s.tabs[id]?.favicon)
  const displayName = customTitle || title || 'Onglet'
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-1.5 px-2 text-xs text-slate-200')}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {favicon ? (
          <img src={favicon} alt="" className="size-4 rounded-sm" />
        ) : (
          <Globe className="size-3.5 text-slate-500" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{displayName}</span>
    </div>
  )
}
