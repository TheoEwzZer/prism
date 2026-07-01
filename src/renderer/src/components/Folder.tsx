import { ChevronRight, Folder as FolderIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'
import { TabItem } from './TabItem'
import type { FolderState } from '@shared/types'

/** Dossier rétractable (espace / groupe d'onglets) contenant des onglets imbriqués. */
export function Folder({
  folder,
  childIds
}: {
  folder: FolderState
  childIds: string[]
}): React.JSX.Element {
  const toggleFolder = useTabsStore((s) => s.toggleFolder)

  return (
    <Collapsible open={!folder.collapsed} onOpenChange={() => toggleFolder(folder.id)}>
      <CollapsibleTrigger
        className={cn(
          'group flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-xs font-medium',
          'text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200'
        )}
      >
        <ChevronRight
          className={cn('size-3.5 transition-transform', !folder.collapsed && 'rotate-90')}
        />
        <FolderIcon className="size-3.5" />
        <span className="truncate">{folder.name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <div className="ml-4 flex flex-col gap-0.5 border-l border-white/5 pl-1 pt-0.5">
          {childIds.map((id) => (
            <TabItem key={id} id={id} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
