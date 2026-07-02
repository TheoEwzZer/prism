import { useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTabsStore } from '@/store/tabsStore'
import { TabItem } from './TabItem'
import { SortableTab } from './SortableTab'
import { Folder } from './Folder'

/** Les deux zones triables de la sidebar. Sert aussi d'id de conteneur droppable (dépôt à vide). */
export type DropZone = 'fav' | 'cur'

type Lists = { fav: string[]; cur: string[] }

/** Résout le conteneur d'un id (item ou id de zone). */
function containerOf(lists: Lists, id: string): DropZone | null {
  if (id === 'fav' || id === 'cur') return id
  if (lists.fav.includes(id)) return 'fav'
  if (lists.cur.includes(id)) return 'cur'
  return null
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

/**
 * Corps de la sidebar façon Arc : liste de favoris (dossiers + onglets épinglés) en haut, une
 * barre « Vider » au milieu, puis les onglets actuels. Drag & drop (dnd-kit) pour réordonner
 * dans chaque zone ET déplacer un onglet entre favoris et actuels.
 *
 * Pendant un drag, on travaille sur une copie locale des deux listes (`lists`) que `onDragOver`
 * mutte en direct (déplacement inter-zones fluide) ; `onDragEnd` commit dans le store via
 * `commitLists`. Au repos, on rend directement les listes dérivées du store.
 */
export function SidebarTabs(): React.JSX.Element {
  const order = useTabsStore((s) => s.order)
  const pinnedIds = useTabsStore((s) => s.pinnedIds)
  const folders = useTabsStore((s) => s.folders)
  const commitLists = useTabsStore((s) => s.commitLists)
  const removeTab = useTabsStore((s) => s.removeTab)

  // Lecture non réactive : le regroupement ne dépend que de `order`/`pinnedIds`/`folders`.
  const tabs = useTabsStore.getState().tabs
  const pinnedSet = new Set(pinnedIds)
  const isRoot = (id: string): boolean => Boolean(tabs[id]) && tabs[id].parentFolderId === null

  const favBase = pinnedIds.filter(isRoot)
  const curBase = order.filter((id) => isRoot(id) && !pinnedSet.has(id))

  // Enfants de dossiers (rendus dans la zone favoris, comme dans Arc).
  const childrenByFolder = new Map<string, string[]>()
  for (const f of folders) childrenByFolder.set(f.id, [])
  for (const id of order) {
    const parent = tabs[id]?.parentFolderId
    if (parent && childrenByFolder.has(parent)) childrenByFolder.get(parent)!.push(id)
  }

  const [dragging, setDragging] = useState<string | null>(null)
  const [lists, setLists] = useState<Lists | null>(null)
  const listsRef = useRef<Lists | null>(null)
  const setBoth = (next: Lists | null): void => {
    listsRef.current = next
    setLists(next)
  }

  const fav = lists?.fav ?? favBase
  const cur = lists?.cur ?? curBase

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const onDragStart = (e: DragStartEvent): void => {
    setDragging(e.active.id as string)
    setBoth({ fav: favBase, cur: curBase })
    // Marque un drag en cours : dans la fenêtre-overlay, ça empêche le hit-test de repasser en
    // click-through (et de fermer le peek) quand le curseur survole le DragOverlay. Sans effet
    // dans la fenêtre principale.
    document.body.setAttribute('data-dnd-dragging', '')
  }

  const onDragOver = (e: DragOverEvent): void => {
    const activeId = e.active.id as string
    const overId = e.over?.id as string | undefined
    const prev = listsRef.current
    if (!overId || !prev) return
    const from = containerOf(prev, activeId)
    const to = containerOf(prev, overId)
    if (!from || !to || from === to) return

    const source = [...prev[from]]
    const dest = [...prev[to]]
    const ai = source.indexOf(activeId)
    if (ai < 0) return
    source.splice(ai, 1)
    let di = overId === to ? dest.length : dest.indexOf(overId)
    if (di < 0) di = dest.length
    dest.splice(di, 0, activeId)
    const next: Lists = { ...prev }
    next[from] = source
    next[to] = dest
    setBoth(next)
  }

  const onDragEnd = (e: DragEndEvent): void => {
    const activeId = e.active.id as string
    const overId = e.over?.id as string | undefined
    const prev = listsRef.current
    if (prev && overId) {
      const zone = prev.fav.includes(activeId) ? 'fav' : 'cur'
      const items = prev[zone]
      const oldI = items.indexOf(activeId)
      let newI = overId === zone ? items.length - 1 : items.indexOf(overId)
      if (newI < 0) newI = items.length - 1
      const finalItems = oldI >= 0 && newI >= 0 ? arrayMove(items, oldI, newI) : items
      commitLists(zone === 'fav' ? finalItems : prev.fav, zone === 'cur' ? finalItems : prev.cur)
    }
    setBoth(null)
    setDragging(null)
    document.body.removeAttribute('data-dnd-dragging')
  }

  const clearCurrent = (): void => {
    for (const id of curBase) {
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setBoth(null)
        setDragging(null)
        document.body.removeAttribute('data-dnd-dragging')
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Zone favoris : dossiers + onglets épinglés */}
        <ScrollArea className="min-h-0 flex-1 px-2">
          <ZoneArea zone="fav" className="flex flex-col gap-0.5 pt-1 pb-2">
            {folders.map((f) => (
              <Folder key={f.id} folder={f} childIds={childrenByFolder.get(f.id) ?? []} />
            ))}
            <SortableContext items={fav} strategy={verticalListSortingStrategy}>
              {fav.map((id) => (
                <SortableTab key={id} id={id} zone="fav" />
              ))}
            </SortableContext>
            {fav.length === 0 && folders.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-slate-500">
                Glissez un onglet ici pour l&apos;épingler
              </p>
            )}
          </ZoneArea>
        </ScrollArea>

        {/* Barre : séparateur + bouton Vider (ferme les onglets actuels) */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="h-px flex-1 bg-white/10" />
          <button
            onClick={clearCurrent}
            disabled={curBase.length === 0}
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
            <SortableContext items={cur} strategy={verticalListSortingStrategy}>
              {cur.map((id) => (
                <SortableTab key={id} id={id} zone="cur" />
              ))}
            </SortableContext>
          </ZoneArea>
        </ScrollArea>
      </div>

      <DragOverlay>{dragging ? <TabItem id={dragging} /> : null}</DragOverlay>
    </DndContext>
  )
}
