import { Fragment, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTabsStore } from '@/store/tabsStore'
import { TabItem } from './TabItem'
import { SortableTab } from './SortableTab'
import { Folder } from './Folder'
import { SplitItem } from './SplitItem'
import { cn } from '@/lib/utils'
import type { SplitState } from '@shared/types'

/** Les deux zones triables de la sidebar. Sert aussi d'id de conteneur droppable (dépôt à vide). */
export type DropZone = 'fav' | 'cur'

/** Position de la ligne d'insertion pendant un drag (façon Arc) : zone + index d'insertion. */
type Indicator = { zone: DropZone; index: number }

const SPLIT_PREFIX = 'split:'

/** Fine ligne blanche d'insertion (indique la future position de l'onglet, sans reflow). */
function DropLine(): React.JSX.Element {
  return <div className="mx-1 my-0.5 h-0.5 shrink-0 rounded-full bg-white/80" />
}

/** Zone de dépôt d'une liste (permet le drop dans une zone vide / dans les marges). */
function ZoneArea({
  zone,
  className,
  children
}: {
  zone: DropZone
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef } = useDroppable({ id: zone })
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  )
}

function SortableSplit({
  id,
  split,
  zone
}: {
  id: string
  split: SplitState
  zone: DropZone
}): React.JSX.Element {
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id, data: { zone } })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn('relative outline-none cursor-pointer', isDragging && 'opacity-50')}
    >
      <SplitItem split={split} />
    </div>
  )
}

/**
 * Détection de collision : priorité aux zones centrales de split (`split:<id>`) via `pointerWithin`
 * (le pointeur doit être dans le rect central) → survoler le centre d'un onglet propose un split.
 * Sinon, tri classique (`closestCorners`) sur les onglets/zones normaux.
 */
const collisionDetection: CollisionDetection = (args) => {
  const isActiveSplit = String(args.active.id).startsWith('split-')

  if (!isActiveSplit) {
    const hit = pointerWithin(args).find(
      (c) => String(c.id).startsWith(SPLIT_PREFIX) && !String(c.id).startsWith('split-')
    )
    if (hit) return [hit]
  }

  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => !(String(c.id).startsWith(SPLIT_PREFIX) && !String(c.id).startsWith('split-'))
    )
  })
}

/**
 * Corps de la sidebar façon Arc : liste de favoris (dossiers + onglets épinglés) en haut, une
 * barre « Vider » au milieu, puis les onglets actuels. Drag & drop (dnd-kit) pour réordonner
 * dans chaque zone ET déplacer un onglet entre favoris et actuels.
 */
export function SidebarTabs(): React.JSX.Element {
  const order = useTabsStore((s) => s.order)
  const pinnedIds = useTabsStore((s) => s.pinnedIds)
  const folders = useTabsStore((s) => s.folders)
  const splits = useTabsStore((s) => s.splits)
  const commitLists = useTabsStore((s) => s.commitLists)
  const removeTab = useTabsStore((s) => s.removeTab)

  const tabs = useTabsStore.getState().tabs
  const pinnedSet = new Set(pinnedIds)

  const splitByTabId = new Map<string, SplitState>()
  for (const s of splits) {
    splitByTabId.set(s.tabIds[0], s)
    splitByTabId.set(s.tabIds[1], s)
  }

  const isRootTab = (id: string): boolean => Boolean(tabs[id]) && tabs[id].parentFolderId === null

  // Construction des listes visuelles (mélangeant IDs d'onglets et IDs de splits sous la forme `split-{id}`)
  const visualFavBase: string[] = []
  const visualCurBase: string[] = []
  const seenSplits = new Set<string>()

  for (const id of pinnedIds) {
    if (!isRootTab(id)) continue
    const split = splitByTabId.get(id)
    if (split) {
      if (!seenSplits.has(split.id)) {
        seenSplits.add(split.id)
        visualFavBase.push(`split-${split.id}`)
      }
    } else {
      visualFavBase.push(id)
    }
  }

  for (const id of order) {
    if (!isRootTab(id) || pinnedSet.has(id)) continue
    const split = splitByTabId.get(id)
    if (split) {
      if (!seenSplits.has(split.id)) {
        seenSplits.add(split.id)
        visualCurBase.push(`split-${split.id}`)
      }
    } else {
      visualCurBase.push(id)
    }
  }

  const expandVisualToRaw = (visualIds: string[]): string[] => {
    return visualIds.flatMap(vid => {
      if (vid.startsWith('split-')) {
        const splitId = vid.slice(6)
        const split = splits.find(s => s.id === splitId)
        return split ? split.tabIds : []
      }
      return [vid]
    })
  }

  // Enfants de dossiers
  const childrenByFolder = new Map<string, string[]>()
  for (const f of folders) childrenByFolder.set(f.id, [])
  for (const id of order) {
    if (splitByTabId.has(id)) continue // exclus des dossiers
    const parent = tabs[id]?.parentFolderId
    if (parent && childrenByFolder.has(parent)) childrenByFolder.get(parent)!.push(id)
  }

  const [dragging, setDragging] = useState<string | null>(null)
  const [splitTarget, setSplitTarget] = useState<string | null>(null)
  const [indicator, setIndicator] = useState<Indicator | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const zoneOfId = (id: string): DropZone | null => {
    if (id === 'fav' || id === 'cur') return id
    if (visualFavBase.includes(id)) return 'fav'
    if (visualCurBase.includes(id)) return 'cur'
    return null
  }

  const resetDrag = (): void => {
    setSplitTarget(null)
    setIndicator(null)
    setDragging(null)
    document.body.removeAttribute('data-dnd-dragging')
  }

  const onDragStart = (e: DragStartEvent): void => {
    setDragging(e.active.id as string)
    document.body.setAttribute('data-dnd-dragging', '')
  }

  const onDragOver = (e: DragOverEvent): void => {
    const activeId = e.active.id as string
    const overId = e.over?.id as string | undefined
    
    if (overId?.startsWith(SPLIT_PREFIX) && !overId.startsWith('split-')) {
      const targetId = overId.slice(SPLIT_PREFIX.length)
      setSplitTarget(targetId === activeId ? null : targetId)
      setIndicator(null)
      return
    }
    setSplitTarget(null)
    const zone = overId ? zoneOfId(overId) : null
    if (!overId || !zone) {
      setIndicator(null)
      return
    }
    if (overId === 'fav' || overId === 'cur') {
      setIndicator({ zone, index: (zone === 'fav' ? visualFavBase : visualCurBase).length })
      return
    }
    const list = zone === 'fav' ? visualFavBase : visualCurBase
    const pos = list.indexOf(overId)
    const activeRect = e.active.rect.current.translated
    const overRect = e.over?.rect
    const after =
      activeRect && overRect
        ? activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
        : false
    setIndicator({ zone, index: pos + (after ? 1 : 0) })
  }

  const onDragEnd = (e: DragEndEvent): void => {
    const activeId = e.active.id as string
    const overId = e.over?.id as string | undefined
    
    if (overId?.startsWith(SPLIT_PREFIX) && !overId.startsWith('split-')) {
      const targetId = overId.slice(SPLIT_PREFIX.length)
      // On ne crée une division qu'avec de vrais onglets, pas si on drag un groupe complet
      if (targetId !== activeId && !activeId.startsWith('split-')) {
        window.prism.createSplitFromTabs({ firstId: targetId, secondId: activeId })
      }
      resetDrag()
      return
    }
    
    if (indicator) {
      const fav = visualFavBase.filter((x) => x !== activeId)
      const cur = visualCurBase.filter((x) => x !== activeId)
      const srcZone = visualFavBase.includes(activeId) ? 'fav' : visualCurBase.includes(activeId) ? 'cur' : null
      let idx = indicator.index
      if (srcZone === indicator.zone) {
        const srcPos = (srcZone === 'fav' ? visualFavBase : visualCurBase).indexOf(activeId)
        if (srcPos >= 0 && srcPos < idx) idx--
      }
      const dest = indicator.zone === 'fav' ? fav : cur
      dest.splice(Math.max(0, Math.min(idx, dest.length)), 0, activeId)
      
      commitLists(expandVisualToRaw(fav), expandVisualToRaw(cur))
    }
    resetDrag()
  }

  const clearCurrent = (): void => {
    const idsToClose = visualCurBase.flatMap(vid => {
      if (vid.startsWith('split-')) {
         return splits.find(s => s.id === vid.slice(6))?.tabIds || []
      }
      return [vid]
    })
    for (const id of idsToClose) {
      window.prism.closeTab(id)
      removeTab(id)
    }
  }

  const newTab = (): void => {
    window.prism.openCommandPalette({
      mode: 'newTab',
      activeId: useTabsStore.getState().activeTabId
    })
  }

  const renderVisualItem = (id: string, zone: DropZone, index: number, isFav: boolean) => {
    const isSplit = id.startsWith('split-')
    const splitState = isSplit ? splits.find(s => s.id === id.slice(6)) : null

    return (
      <Fragment key={id}>
        {indicator?.zone === zone && indicator.index === index && <DropLine />}
        {isSplit && splitState ? (
           <SortableSplit id={id} split={splitState} zone={zone} />
        ) : (
           <SortableTab
             id={id}
             zone={zone}
             dragActive={dragging !== null}
             previewOtherId={splitTarget === id ? dragging : null}
           />
        )}
      </Fragment>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={resetDrag}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Zone favoris : dossiers + onglets épinglés */}
        <ScrollArea className="min-h-0 flex-1 px-2">
          <ZoneArea zone="fav" className="flex flex-col gap-0.5 pt-1 pb-2">
            {folders.map((f) => (
              <Folder key={f.id} folder={f} childIds={childrenByFolder.get(f.id) ?? []} />
            ))}
            <SortableContext items={visualFavBase} strategy={verticalListSortingStrategy}>
              {visualFavBase.map((id, i) => renderVisualItem(id, 'fav', i, true))}
              {indicator?.zone === 'fav' && indicator.index === visualFavBase.length && <DropLine />}
            </SortableContext>
            {visualFavBase.length === 0 && folders.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-slate-500">
                Glissez un onglet ici pour l&apos;épingler
              </p>
            )}
          </ZoneArea>
        </ScrollArea>

        {/* Barre : séparateur + bouton Vider */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="h-px flex-1 bg-white/10" />
          <button
            onClick={clearCurrent}
            disabled={visualCurBase.length === 0}
            className="app-no-drag flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="size-3" />
            Vider
          </button>
        </div>

        {/* Zone onglets actuels */}
        <ScrollArea className="min-h-0 flex-1 px-2">
          <ZoneArea zone="cur" className="flex flex-col gap-0.5 pb-2">
            <button
              onClick={newTab}
              className="app-no-drag flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            >
              <Plus className="size-4" />
              <span>Nouvel onglet</span>
            </button>
            <SortableContext items={visualCurBase} strategy={verticalListSortingStrategy}>
              {visualCurBase.map((id, i) => renderVisualItem(id, 'cur', i, false))}
              {indicator?.zone === 'cur' && indicator.index === visualCurBase.length && <DropLine />}
            </SortableContext>
          </ZoneArea>
        </ScrollArea>
      </div>

      <DragOverlay>
        {dragging ? (
          dragging.startsWith('split-') ? (
            <SplitItem split={splits.find(s => s.id === dragging.slice(6))!} />
          ) : (
            <TabItem id={dragging} />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
