import { Plus } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTabsStore } from '@/store/tabsStore'
import { TabItem } from './TabItem'
import { Folder } from './Folder'

/**
 * Liste verticale des onglets + dossiers.
 *
 * Perf : ce composant s'abonne UNIQUEMENT à `order` et `folders` (structure). Il ne lit PAS
 * le contenu des onglets de façon réactive → un patch title/favicon ne le re-render jamais.
 * Le `parentFolderId` (stable, jamais modifié par un patch) est lu via un snapshot
 * non réactif pour regrouper les onglets par dossier.
 */
export function TabList(): React.JSX.Element {
  const order = useTabsStore((s) => s.order)
  const folders = useTabsStore((s) => s.folders)

  // Lecture non réactive : le regroupement ne dépend que de `order`/`folders` (réactifs).
  const tabs = useTabsStore.getState().tabs
  const rootIds = order.filter((id) => tabs[id] && tabs[id].parentFolderId === null)
  const childrenByFolder = new Map<string, string[]>()
  for (const folder of folders) childrenByFolder.set(folder.id, [])
  for (const id of order) {
    const parent = tabs[id]?.parentFolderId
    if (parent && childrenByFolder.has(parent)) childrenByFolder.get(parent)!.push(id)
  }

  const newTab = (): void => {
    // Ouvre la palette de commande (façon Arc) plutôt que de créer un onglet vide directement.
    window.prism.openCommandPalette({
      mode: 'newTab',
      activeId: useTabsStore.getState().activeTabId
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="flex flex-col gap-0.5 pb-2">
          {folders.map((folder) => (
            <Folder
              key={folder.id}
              folder={folder}
              childIds={childrenByFolder.get(folder.id) ?? []}
            />
          ))}
          {rootIds.map((id) => (
            <TabItem key={id} id={id} />
          ))}
        </div>
      </ScrollArea>

      <button
        onClick={() => void newTab()}
        className="app-no-drag mx-2 mb-2 flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
      >
        <Plus className="size-4" />
        <span>Nouvel onglet</span>
      </button>
    </div>
  )
}
