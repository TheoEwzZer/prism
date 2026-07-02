import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TabItem } from './TabItem'
import type { DropZone } from './SidebarTabs'

/**
 * Onglet rendu dans une zone triable (favoris ou onglets actuels). Fournit à `TabItem` la
 * liaison drag & drop de dnd-kit. `data.zone` permet à l'orchestrateur (`SidebarTabs`) de
 * savoir de quelle zone provient l'élément survolé.
 */
export function SortableTab({ id, zone }: { id: string; zone: DropZone }): React.JSX.Element {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    data: { zone }
  })

  return (
    <TabItem
      id={id}
      drag={{
        setNodeRef,
        attributes,
        listeners,
        style: { transform: CSS.Translate.toString(transform), transition },
        isDragging
      }}
    />
  )
}
