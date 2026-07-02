import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/store/tabsStore'

/**
 * Écoute le flux batché `tab:updated` du Main et applique les patchs au store.
 *
 * Anti-race : on ignore tout batch dont le `batchId` est <= au dernier reçu (utile lors de
 * switchs rapides d'onglets). Les patchs d'un batch valide sont appliqués en un seul `set`.
 */
export function useTabEvents(): void {
  const applyBatch = useTabsStore((s) => s.applyBatch)
  const addTab = useTabsStore((s) => s.addTab)
  const removeTab = useTabsStore((s) => s.removeTab)
  const applyRemoteUi = useTabsStore((s) => s.applyRemoteUi)
  const setRenamingTab = useTabsStore((s) => s.setRenamingTab)
  const lastBatchId = useRef(0)

  useEffect(() => {
    const unsubscribe = window.prism.onTabUpdated((batch) => {
      if (batch.batchId <= lastBatchId.current) return
      lastBatchId.current = batch.batchId
      applyBatch(batch.patches)
    })
    return unsubscribe
  }, [applyBatch])

  // Création / fermeture d'onglet (quelle que soit l'origine : sidebar, favori, palette). Le
  // Main est la source unique qui diffuse aux deux fenêtres ; on met à jour le store (idempotent).
  useEffect(() => window.prism.onTabCreated(addTab), [addTab])
  useEffect(() => window.prism.onTabClosed(removeTab), [removeTab])

  // Convergence de l'état organisationnel (ordre, favoris, dossiers, onglet actif) rediffusé
  // par le Main depuis l'AUTRE fenêtre (principale ↔ overlay). Anti-écho géré dans le store.
  useEffect(() => window.prism.onUiStateSync(applyRemoteUi), [applyRemoteUi])

  // Édition inline du nom (« Renommer ») : diffusée par le Main aux deux fenêtres (l'onglet peut
  // être dans la sidebar principale ou dans le peek de l'overlay).
  useEffect(() => window.prism.onTabRenaming(setRenamingTab), [setRenamingTab])
}
