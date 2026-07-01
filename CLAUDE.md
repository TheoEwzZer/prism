# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

Prism est un navigateur web de bureau (MVP) inspiré d'Arc Browser, optimisé Windows. Stack : Electron 39 + React 19 + TypeScript + Vite 7 (via `electron-vite`), Tailwind v4, shadcn/ui (Radix), Zustand. Le gestionnaire de paquets est **`pnpm`** (voir `pnpm-lock.yaml`).

## Commandes

```bash
pnpm install          # installe + electron-builder install-app-deps (postinstall)
pnpm dev              # lance l'app en dev (HMR renderer + reload main)
pnpm start            # preview d'un build (electron-vite preview)
pnpm build            # typecheck complet PUIS electron-vite build
pnpm build:win        # build + package Windows (electron-builder)
pnpm typecheck        # typecheck:node + typecheck:web (les deux tsconfig)
pnpm lint             # eslint --cache .
pnpm format           # prettier --write .
```

Il n'y a **pas de framework de tests** dans ce dépôt. La vérification pré-commit passe par `pnpm typecheck` et `pnpm lint`. Le typecheck est scindé en deux configs qu'il faut lancer séparément pour cibler un côté : `pnpm typecheck:node` (main + preload, `tsconfig.node.json`) et `pnpm typecheck:web` (renderer, `tsconfig.web.json`).

## Architecture

Trois espaces sous `src/`, avec des alias de résolution distincts (voir `electron.vite.config.ts`) :
- `src/main/` — process Main Electron.
- `src/preload/` — bridge sécurisé (`@shared` dispo).
- `src/renderer/src/` — UI React (alias `@`, `@renderer`, `@shared`).
- `src/shared/` — types + constantes IPC partagés (`@shared`), **source unique de vérité** de la frontière Main↔Renderer (`src/shared/types.ts`).

### Principe fondateur : la vue native au-dessus du DOM React

Le moteur de rendu de chaque onglet est une `WebContentsView` **native** peinte par-dessus le DOM React, par le Main. Ce choix conditionne toute l'architecture :

- **Le Main est la SEULE source de vérité du layout/bounds.** Le Renderer n'émet que des *intentions* (`SidebarIntent = { width, collapsed }`), jamais de pixels bruts. Les bounds réels de la vue sont calculés dans `TabManager.computeBounds()` et appliqués côté Main. Toute UI qui doit apparaître au-dessus de la page web (barre supérieure, contrôles) doit vivre dans le chrome React **hors** de la zone recouverte par la vue native — d'où la `TopBar` pleine largeur et la vue web qui démarre à l'offset `TOPBAR_HEIGHT = 44` (à garder synchronisé avec la classe `h-11` de `TopBar.tsx`).
- **Séparation des états.** Le Main détient le « browser state » (navigation réelle, WebContentsView, bounds). Le Renderer/Zustand ne détient que du « UI state » (titre, favicon, loading, ordre, dossiers, onglet actif, sidebar). Ne pas dupliquer l'un dans l'autre.
- **Fenêtre frameless.** `frame: false` dans `src/main/index.ts` ; les contrôles min/max/close sont des boutons React qui parlent au Main via IPC (`WINDOW_*`).
- **Menu applicatif désactivé** (`Menu.setApplicationMenu(null)`) pour éviter les accélérateurs par défaut ; F12 / Ctrl+Shift+I sont interceptés dans `TabManager` via `before-input-event`.

### Flux IPC (câblage : `src/main/ipc/registerIpc.ts`)

Tous les noms de canaux vivent dans l'objet `IPC` de `src/shared/types.ts` et sont importés des deux côtés. Le preload (`src/preload/index.ts`) expose une **whitelist stricte** `window.prism` — aucune primitive `invoke`/`send` générique n'est exposée.

- **Renderer → Main** : `invoke` pour ce qui attend une réponse (`session:get`, `tab:create`, `overlay:getData`), `send` fire-and-forget pour le reste.
- **Main → Renderer** : events. Le canal chaud est `tab:updated`, émis en **batch coalescé** : `registerIpc.ts` accumule les patchs par onglet dans une `Map`, les coalesce sur ~16 ms (`FrameCoalescer`), et envoie un `TabUpdateBatch { batchId, patches }`. Le `batchId` est **monotone** — côté Renderer, `useTabEvents` ignore tout batch dont l'id est ≤ au dernier reçu (anti-race lors des switchs rapides d'onglets). Ne pas contourner ce mécanisme en envoyant des events par onglet non batchés.

### TabManager (`src/main/tabs/TabManager.ts`) — cœur métier

Gère le cycle de vie des `WebContentsView`, le layout, le focus, l'hibernation. Points structurants :

- **Hibernation façon Arc.** Un onglet inactif est d'abord juste masqué (`setVisible(false)`) → réveil instantané. La **destruction** de la vue n'intervient qu'au dépassement du cap `MAX_LIVE_VIEWS = 8` (éviction LRU des inactifs). Au boot, les onglets restaurés sont enregistrés en état hiberné (lazy) sans créer de vue — la `WebContentsView` n'est recréée qu'au premier clic (`ensureView`).
- **Recompute des bounds coalescé** via `FrameCoalescer` (un seul recompute par frame, quelle que soit la source : intention React ou resize natif) + garde `lastLayoutSig` pour éviter les `setBounds` inutiles.
- **Contraintes API Electron 39 assumées** (ne pas « corriger » sans raison) : `WebContents` n'expose pas `destroy()` ni `blur()`. La destruction passe par `removeChildView()` + `webContents.close()` + `entry.view = null` (libère le process de rendu, éligible au GC). Le « blur » de l'ancienne vue est implicite : `focus()` sur la nouvelle + `setVisible(false)` sur l'ancienne.
- **DevTools** : ouvert en natif via `openDevTools({ mode: 'right' })` sur la page active (`toggleDevTools`).
- **Omnibox** : `normalizeInput()` décide URL directe vs domaine (→ `https://`) vs recherche Google.

### Overlays natifs (Site Control Center)

Un popover React passerait **derrière** la `WebContentsView`. Les menus flottants sont donc des **fenêtres-overlay natives** : `src/main/overlay/SiteControlOverlay.ts` (transparente, sizée au contenu, auto-close au blur) charge la route `?overlay=siteControl` du **même bundle renderer** (`src/renderer/src/main.tsx` route vers `src/renderer/src/overlay/SiteControlOverlay.tsx`). Le Main convertit les coordonnées client (`anchorRight`/`anchorBottom`) en coordonnées écran. Ne pas remplacer par un popover DOM.

### État Renderer (`src/renderer/src/store/tabsStore.ts`)

Store Zustand purement UI. Perf : les composants s'abonnent à des **champs atomiques** (`tabs[id].title`…), jamais à l'objet onglet entier ni à `order`. `applyBatch` ne crée une nouvelle référence que pour les onglets réellement modifiés et retourne `{}` (aucun re-render) si rien ne change. Conserver cette discipline lors de l'ajout de champs. Hooks associés : `useSession` (hydrate + persiste l'UI), `useTabEvents` (applique les batchs), `useSidebarLayout` (émet les intentions de layout).

### Persistance (`src/main/persistence/sessionStore.ts`)

Session sérialisée en JSON dans `userData/prism-session.json`, écriture **debouncée** (~800 ms) pour ne pas écrire à chaque frappe. `flushSession()` force l'écriture synchrone sur `before-quit` (`runtime.persistNow()`). Au chargement, les onglets sont toujours forcés en `isHibernated: true` (lazy loading).

## Composants shadcn/ui

`components.json` configure shadcn. Les primitives sous `src/renderer/src/components/ui/` sont générées ; préférer `pnpm dlx shadcn@latest add <composant>` plutôt que de les écrire à la main. Utilitaire `cn()` (clsx + tailwind-merge) dans `src/renderer/src/lib/utils.ts`.
