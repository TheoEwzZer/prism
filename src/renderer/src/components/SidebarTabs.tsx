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
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTabsStore } from '@/store/tabsStore'
import { TabItem } from './TabItem'
import { SortableTab } from './SortableTab'
import { Folder } from './Folder'
import { SplitItem } from './SplitItem'

/** Les deux zones triables de la sidebar. Sert aussi d'id de conteneur droppable (dépôt à vide). */
export type DropZone = 'fav' | 'cur'

/** Position de la ligne d'insertion pendant un drag (façon Arc) : zone + index d'insertion. */
type Indicator = { zone: DropZone; index: number }

const SPLIT_PREFIX = 'split:'

/** Fine ligne blanche d'insertion (indique la future position de l'onglet, sans reflow). */
function DropLine(): React.JSX.Element {
  return <div className="mx-1 my-0.5 h-0.5 shrink-0 rounded-full bg-white/80" />
}

/**
 * Détection de collision : priorité aux zones centrales de split (`split:<id>`) via `pointerWithin`
 * (le pointeur doit être dans le rect central) → survoler le centre d'un onglet propose un split.
 * Sinon, tri classique (`closestCorners`) sur les onglets/zones normaux.
 */
const collisionDetection: CollisionDetection = (args) => {
  const hit = pointerWithin(args).find((c) => String(c.id).startsWith(SPLIT_PREFIX))
  if (hit) return [hit]
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => !String(c.id).startsWith(SPLIT_PREFIX)
    )
  })
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
  const splits = useTabsStore((s) => s.splits)
  const commitLists = useTabsStore((s) => s.commitLists)
  const removeTab = useTabsStore((s) => s.removeTab)

  // Lecture non réactive : le regroupement ne dépend que de `order`/`pinnedIds`/`folders`.
  const tabs = useTabsStore.getState().tabs
  const pinnedSet = new Set(pinnedIds)
  // Onglets membres d'une division : exclus des listes normales (rendus dans leur pilule SplitItem).
  const splitMemberSet = new Set(splits.flatMap((s) => s.tabIds))
  const isRoot = (id: string): boolean =>
    Boolean(tabs[id]) && tabs[id].parentFolderId === null && !splitMemberSet.has(id)

  const favBase = pinnedIds.filter(isRoot)
  const curBase = order.filter((id) => isRoot(id) && !pinnedSet.has(id))

  // Enfants de dossiers (rendus dans la zone favoris, comme dans Arc).
  const childrenByFolder = new Map<string, string[]>()
  for (const f of folders) childrenByFolder.set(f.id, [])
  for (const id of order) {
    if (splitMemberSet.has(id)) continue
    const parent = tabs[id]?.parentFolderId
    if (parent && childrenByFolder.has(parent)) childrenByFolder.get(parent)!.push(id)
  }

  const [dragging, setDragging] = useState<string | null>(null)
  // Onglet cible d'un aperçu de split (survol du centre d'un autre onglet), ou null.
  const [splitTarget, setSplitTarget] = useState<string | null>(null)
  // Ligne d'insertion (réordonnancement) : les onglets ne bougent pas, seul ce trait se déplace.
  const [indicator, setIndicator] = useState<Indicator | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  /** Zone (`fav`/`cur`) d'un id (onglet ou id de zone), ou null. */
  const zoneOfId = (id: string): DropZone | null => {
    if (id === 'fav' || id === 'cur') return id
    if (favBase.includes(id)) return 'fav'
    if (curBase.includes(id)) return 'cur'
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
    // Marque un drag en cours : dans la fenêtre-overlay, ça empêche le hit-test de repasser en
    // click-through (et de fermer le peek) quand le curseur survole le DragOverlay.
    document.body.setAttribute('data-dnd-dragging', '')
  }

  const onDragOver = (e: DragOverEvent): void => {
    const activeId = e.active.id as string
    const overId = e.over?.id as string | undefined
    // Survol du centre d'un autre onglet → aperçu de split (pas de ligne d'insertion).
    if (overId?.startsWith(SPLIT_PREFIX)) {
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
    // Dépôt dans une zone vide / ses marges (overId = 'fav'/'cur') → ligne en fin de liste.
    if (overId === 'fav' || overId === 'cur') {
      setIndicator({ zone, index: (zone === 'fav' ? favBase : curBase).length })
      return
    }
    // Au-dessus/en dessous du centre d'un onglet : ligne avant/après lui.
    const list = zone === 'fav' ? favBase : curBase
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
    // Drop sur le centre d'un onglet → crée une vue divisée des deux onglets (cible à gauche, déposé
    // à droite).
    if (overId?.startsWith(SPLIT_PREFIX)) {
      const targetId = overId.slice(SPLIT_PREFIX.length)
      if (targetId !== activeId) {
        window.prism.createSplitFromTabs({ firstId: targetId, secondId: activeId })
      }
      resetDrag()
      return
    }
    // Réordonnancement : insère l'onglet à la position de la ligne.
    if (indicator) {
      const fav = favBase.filter((x) => x !== activeId)
      const cur = curBase.filter((x) => x !== activeId)
      const srcZone = favBase.includes(activeId) ? 'fav' : curBase.includes(activeId) ? 'cur' : null
      let idx = indicator.index
      // Retirer l'actif de la même zone décale les positions suivantes de -1.
      if (srcZone === indicator.zone) {
        const srcPos = (srcZone === 'fav' ? favBase : curBase).indexOf(activeId)
        if (srcPos >= 0 && srcPos < idx) idx--
      }
      const dest = indicator.zone === 'fav' ? fav : cur
      dest.splice(Math.max(0, Math.min(idx, dest.length)), 0, activeId)
      commitLists(fav, cur)
    }
    resetDrag()
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
            <SortableContext items={favBase} strategy={verticalListSortingStrategy}>
              {favBase.map((id, i) => (
                <Fragment key={id}>
                  {indicator?.zone === 'fav' && indicator.index === i && <DropLine />}
                  <SortableTab
                    id={id}
                    zone="fav"
                    dragActive={dragging !== null}
                    previewOtherId={splitTarget === id ? dragging : null}
                  />
                </Fragment>
              ))}
              {indicator?.zone === 'fav' && indicator.index === favBase.length && <DropLine />}
            </SortableContext>
            {favBase.length === 0 && folders.length === 0 && (
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
            {/* Vues divisées : pilules groupées (non-draggable), avant les onglets normaux. */}
            {splits.map((s) => (
              <SplitItem key={s.id} split={s} />
            ))}
            <SortableContext items={curBase} strategy={verticalListSortingStrategy}>
              {curBase.map((id, i) => (
                <Fragment key={id}>
                  {indicator?.zone === 'cur' && indicator.index === i && <DropLine />}
                  <SortableTab
                    id={id}
                    zone="cur"
                    dragActive={dragging !== null}
                    previewOtherId={splitTarget === id ? dragging : null}
                  />
                </Fragment>
              ))}
              {indicator?.zone === 'cur' && indicator.index === curBase.length && <DropLine />}
            </SortableContext>
          </ZoneArea>
        </ScrollArea>
      </div>

      <DragOverlay>{dragging ? <TabItem id={dragging} /> : null}</DragOverlay>
    </DndContext>
  )
}
