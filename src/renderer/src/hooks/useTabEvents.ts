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
  const lastBatchId = useRef(0)

  useEffect(() => {
    const unsubscribe = window.prism.onTabUpdated((batch) => {
      if (batch.batchId <= lastBatchId.current) return
      lastBatchId.current = batch.batchId
      applyBatch(batch.patches)
    })
    return unsubscribe
  }, [applyBatch])

  // Création d'onglet (quelle que soit l'origine : sidebar, favori, palette de commande). Le
  // Main est la source unique qui diffuse la meta ; on l'ajoute au store (idempotent).
  useEffect(() => window.prism.onTabCreated(addTab), [addTab])
}
