import { create } from 'zustand'
import type {
  TabState,
  FolderState,
  PinnedApp,
  SessionData,
  TabPatch,
  UiPersistState
} from '@shared/types'

/**
 * Store UI (control layer). Ne contient QUE de l'état d'interface — le "browser state"
 * (navigation réelle, WebContentsView, bounds) vit dans le Main.
 *
 * Perf : les composants s'abonnent à des CHAMPS atomiques (`tabs[id].title`, etc.), jamais
 * à l'objet onglet entier ni à `order`. `applyBatch` ne crée une nouvelle référence que
 * pour les onglets réellement modifiés, et seulement si un champ change.
 */
interface TabsState {
  tabs: Record<string, TabState>
  order: string[]
  folders: FolderState[]
  pinnedApps: PinnedApp[]
  activeTabId: string | null
  sidebarCollapsed: boolean
  sidebarWidth: number

  // --- Actions ---
  hydrate: (session: SessionData) => void
  applyBatch: (patches: Array<{ id: string; patch: TabPatch }>) => void
  addTab: (tab: TabState) => void
  removeTab: (id: string) => void
  setActive: (id: string) => void
  toggleFolder: (id: string) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  /** Snapshot sérialisable pour la persistance côté Main. */
  toPersist: () => UiPersistState
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: {},
  order: [],
  folders: [],
  pinnedApps: [],
  activeTabId: null,
  sidebarCollapsed: false,
  sidebarWidth: 256,

  hydrate: (session): void => {
    const tabs: Record<string, TabState> = {}
    for (const t of session.tabs) tabs[t.id] = t
    // On ne conserve dans `order` que des ids d'onglets réellement présents.
    const order = session.order.filter((id) => tabs[id])
    for (const id of Object.keys(tabs)) if (!order.includes(id)) order.push(id)
    set({
      tabs,
      order,
      folders: session.folders,
      pinnedApps: session.pinnedApps,
      activeTabId: session.activeTabId,
      sidebarCollapsed: session.sidebarCollapsed,
      sidebarWidth: session.sidebarWidth
    })
  },

  applyBatch: (patches): void => {
    set((state) => {
      const draft: Record<string, TabState> = { ...state.tabs }
      let changed = false
      for (const { id, patch } of patches) {
        const cur = draft[id]
        if (!cur) continue
        let tabChanged = false
        for (const key of Object.keys(patch) as Array<keyof TabPatch>) {
          const value = patch[key]
          if (value !== undefined && cur[key] !== value) {
            tabChanged = true
            break
          }
        }
        if (tabChanged) {
          draft[id] = { ...cur, ...patch }
          changed = true
        }
      }
      // Retourner {} = aucune mise à jour → aucun re-render.
      return changed ? { tabs: draft } : {}
    })
  },

  addTab: (tab): void => {
    set((state) => ({
      tabs: { ...state.tabs, [tab.id]: tab },
      order: state.order.includes(tab.id) ? state.order : [...state.order, tab.id],
      activeTabId: tab.id
    }))
  },

  removeTab: (id): void => {
    set((state) => {
      if (!state.tabs[id]) return {}
      const tabs = { ...state.tabs }
      delete tabs[id]
      const order = state.order.filter((tid) => tid !== id)
      let activeTabId = state.activeTabId
      if (activeTabId === id) {
        const idx = state.order.indexOf(id)
        activeTabId = order[Math.min(idx, order.length - 1)] ?? null
      }
      return { tabs, order, activeTabId }
    })
  },

  setActive: (id): void => set({ activeTabId: id }),

  toggleFolder: (id): void => {
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
    }))
  },

  setSidebarCollapsed: (collapsed): void => set({ sidebarCollapsed: collapsed }),

  toPersist: (): UiPersistState => {
    const s = get()
    return {
      order: s.order,
      folders: s.folders,
      pinnedApps: s.pinnedApps,
      activeTabId: s.activeTabId,
      sidebarWidth: s.sidebarWidth,
      sidebarCollapsed: s.sidebarCollapsed
    }
  }
}))
