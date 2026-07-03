import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Printer,
  Code2,
  Search,
  Copy,
  Link as LinkIcon,
  ExternalLink,
  Columns2,
  Image as ImageIcon,
  Download,
  Scissors,
  ClipboardPaste,
  TextCursorInput,
  SquareArrowOutUpRight
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import type { PageMenuPayload, PageMenuAction } from '@shared/types'

/** Un item du menu : entrée cliquable/accélérée, ou séparateur. */
type MenuItem =
  | 'separator'
  | {
      icon: React.ReactNode
      label: string
      /** Raccourci affiché ET actif tant que le menu est ouvert (ex. `T`, `Ctrl+R`). */
      shortcut?: string
      disabled?: boolean
      run: () => void
    }

/**
 * Un raccourci correspond-il à l'appui clavier ? Les accélérateurs simples (`T`, `B`…) exigent
 * l'absence de modificateur ; les combos (`Ctrl+R`) exigent Ctrl (ou Cmd sur macOS).
 */
function matchesShortcut(shortcut: string | undefined, e: KeyboardEvent): boolean {
  if (!shortcut) return false
  const parts = shortcut.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const wantCtrl = parts.includes('ctrl')
  if (wantCtrl !== (e.ctrlKey || e.metaKey)) return false
  if (!wantCtrl && (e.altKey || e.metaKey || e.ctrlKey)) return false
  return e.key.toLowerCase() === key
}

/**
 * Menu contextuel de la PAGE web (clic droit), rendu DANS la couche d'overlay unique → il flotte
 * AU-DESSUS de la `WebContentsView` native. Contextuel façon Arc : la cible sous le curseur (lien,
 * image, sélection, champ éditable) transmise par le Main via l'event natif `context-menu` décide
 * des entrées affichées. Les raccourcis affichés sont de VRAIS accélérateurs actifs tant que le
 * menu est ouvert (cf. l'effet `keydown`).
 *
 * `data-overlay-hit="pagemenu"` marque la zone interactive pour le hit-test de la couche. La
 * fermeture (clic extérieur / Échap) est gérée par la couche (cf. `OverlayLayer.tsx`).
 */
export function PageContextMenu({ data }: Readonly<{ data: PageMenuPayload }>): React.JSX.Element {
  const {
    tabId,
    x,
    y,
    pageX,
    pageY,
    canGoBack,
    canGoForward,
    linkURL,
    srcURL,
    mediaType,
    selectionText,
    isEditable,
    editFlags,
    pageURL
  } = data

  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - width - 8)
    const top = Math.min(y, window.innerHeight - height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y])

  const close = (): void => window.prism.closePageMenu()
  const act = (action: PageMenuAction): void => {
    window.prism.pageMenuAction(tabId, action)
    close()
  }
  const copy = (text: string): void => {
    if (text) window.prism.copyText(text)
    close()
  }
  const openTab = (url: string): void => {
    if (url) window.prism.createTab({ url })
    close()
  }
  const openInSplit = (url: string): void => {
    if (url) window.prism.createSplit({ position: 'right', sourceId: tabId, url })
    close()
  }

  const isImage = mediaType === 'image' && !!srcURL
  const hasSelection = selectionText.trim().length > 0
  const selectionLabel =
    selectionText.length > 22 ? `${selectionText.slice(0, 22)}…` : selectionText

  const inspect: MenuItem = {
    icon: <Search className="size-4" />,
    label: 'Inspecter',
    shortcut: 'N',
    run: () => act({ type: 'inspect', x: pageX, y: pageY })
  }

  const items: MenuItem[] = []

  if (linkURL || isImage) {
    // Cible LIEN ou IMAGE : menu dédié façon Arc (remplace la navigation), + Inspecter en pied.
    if (linkURL) {
      items.push(
        {
          icon: <ExternalLink className="size-4" />,
          label: 'Ouvrir le lien dans un nouvel onglet',
          shortcut: 'T',
          run: () => openTab(linkURL)
        },
        {
          icon: <Columns2 className="size-4" />,
          label: 'Ouvrir le lien dans une vue divisée',
          run: () => openInSplit(linkURL)
        },
        'separator',
        {
          icon: <Download className="size-4" />,
          label: 'Enregistrer le lien sous…',
          shortcut: 'K',
          run: () => act({ type: 'saveLink', url: linkURL })
        },
        {
          icon: <LinkIcon className="size-4" />,
          label: "Copier l'adresse du lien",
          shortcut: 'E',
          run: () => copy(linkURL)
        }
      )
    }
    if (isImage) {
      if (linkURL) items.push('separator')
      items.push(
        {
          icon: <ImageIcon className="size-4" />,
          label: "Ouvrir l'image dans un nouvel onglet",
          shortcut: 'I',
          run: () => openTab(srcURL)
        },
        {
          icon: <Download className="size-4" />,
          label: "Enregistrer l'image sous…",
          shortcut: 'V',
          run: () => act({ type: 'saveImage', url: srcURL })
        },
        {
          icon: <Copy className="size-4" />,
          label: "Copier l'image",
          shortcut: 'Y',
          run: () => act({ type: 'copyImage', x: pageX, y: pageY })
        },
        {
          icon: <LinkIcon className="size-4" />,
          label: "Copier l'adresse de l'image",
          shortcut: 'O',
          run: () => copy(srcURL)
        },
        {
          icon: <SquareArrowOutUpRight className="size-4" />,
          label: "Rechercher l'image sur Google",
          shortcut: 'S',
          run: () =>
            openTab(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(srcURL)}`)
        }
      )
    }
    items.push('separator', inspect)
  } else if (isEditable) {
    // Champ éditable : presse-papiers.
    items.push(
      {
        icon: <Scissors className="size-4" />,
        label: 'Couper',
        shortcut: 'Ctrl+X',
        disabled: !editFlags.canCut,
        run: () => act({ type: 'cut' })
      },
      {
        icon: <Copy className="size-4" />,
        label: 'Copier',
        shortcut: 'Ctrl+C',
        disabled: !editFlags.canCopy,
        run: () => act({ type: 'copy' })
      },
      {
        icon: <ClipboardPaste className="size-4" />,
        label: 'Coller',
        shortcut: 'Ctrl+V',
        disabled: !editFlags.canPaste,
        run: () => act({ type: 'paste' })
      },
      {
        icon: <TextCursorInput className="size-4" />,
        label: 'Tout sélectionner',
        shortcut: 'Ctrl+A',
        run: () => act({ type: 'selectAll' })
      },
      'separator',
      inspect
    )
  } else {
    // Menu de page par défaut, avec la sélection éventuelle en tête.
    if (hasSelection) {
      items.push(
        {
          icon: <Copy className="size-4" />,
          label: 'Copier',
          shortcut: 'Ctrl+C',
          run: () => copy(selectionText)
        },
        {
          icon: <Search className="size-4" />,
          label: `Rechercher « ${selectionLabel} » sur Google`,
          run: () => openTab(`https://www.google.com/search?q=${encodeURIComponent(selectionText)}`)
        },
        'separator'
      )
    }
    items.push(
      {
        icon: <ArrowLeft className="size-4" />,
        label: 'Retour',
        shortcut: 'B',
        disabled: !canGoBack,
        run: () => {
          window.prism.goBack(tabId)
          close()
        }
      },
      {
        icon: <ArrowRight className="size-4" />,
        label: 'Suivant',
        shortcut: 'F',
        disabled: !canGoForward,
        run: () => {
          window.prism.goForward(tabId)
          close()
        }
      },
      {
        icon: <RotateCw className="size-4" />,
        label: 'Recharger',
        shortcut: 'Ctrl+R',
        run: () => {
          window.prism.reload(tabId)
          close()
        }
      },
      'separator',
      {
        icon: <Printer className="size-4" />,
        label: 'Imprimer…',
        shortcut: 'Ctrl+P',
        run: () => act({ type: 'print' })
      },
      {
        icon: <LinkIcon className="size-4" />,
        label: "Copier l'adresse de la page",
        disabled: !pageURL,
        run: () => copy(pageURL)
      },
      {
        icon: <Code2 className="size-4" />,
        label: 'Afficher le code source',
        shortcut: 'Ctrl+U',
        disabled: !pageURL,
        run: () => openTab(`view-source:${pageURL}`)
      },
      'separator',
      inspect
    )
  }

  // Accélérateurs clavier : tant que le menu est ouvert, l'appui d'un raccourci déclenche son item.
  // On passe par une ref pour garder un listener stable tout en lisant la liste courante.
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      for (const it of itemsRef.current) {
        if (it === 'separator' || it.disabled) continue
        if (matchesShortcut(it.shortcut, e)) {
          e.preventDefault()
          it.run()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      ref={rootRef}
      data-overlay-hit="pagemenu"
      style={{ left: pos.left, top: pos.top }}
      className={cn(
        'pointer-events-auto absolute w-max min-w-[200px] max-w-[380px] overflow-hidden',
        'rounded-lg border border-white/10 bg-popover p-1 text-slate-200 shadow-2xl shadow-black/60'
      )}
    >
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={`sep-${i}`} className="-mx-1 my-1 h-px bg-white/10" />
        ) : (
          <Row
            key={it.label}
            icon={it.icon}
            label={it.label}
            shortcut={it.shortcut}
            disabled={it.disabled}
            onClick={it.run}
          />
        )
      )}
    </div>
  )
}

function Row({
  icon,
  label,
  shortcut,
  onClick,
  disabled
}: Readonly<{
  icon: React.ReactNode
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
}>): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
        'hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40'
      )}
    >
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <KbdGroup>
          {shortcut.split('+').map((k, i) => (
            <Fragment key={k}>
              {i > 0 && <span className="text-slate-500">+</span>}
              <Kbd>{k}</Kbd>
            </Fragment>
          ))}
        </KbdGroup>
      )}
    </button>
  )
}
