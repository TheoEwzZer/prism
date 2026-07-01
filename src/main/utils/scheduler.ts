/**
 * Utilitaires de cadencement pour le Main process.
 * Objectif perf : ne jamais saturer le bridge IPC ni recalculer les bounds inutilement.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => void

/** Debounce trailing classique, avec annulation. */
export function debounce<T extends AnyFn>(fn: T, wait: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, wait)
  }
  debounced.cancel = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  return debounced as T & { cancel: () => void }
}

/**
 * Coalesceur "par frame". Plusieurs `schedule()` déclenchés dans la même fenêtre de temps
 * n'entraînent qu'un seul `flush`. Sert au batch des events IPC et au recalcul des bounds
 * (un seul recompute par frame, quelle que soit la source : intention React ou resize natif).
 */
export class FrameCoalescer {
  private scheduled = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly flush: () => void,
    private readonly frameMs = 16
  ) {}

  schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    this.timer = setTimeout(() => {
      this.scheduled = false
      this.timer = null
      this.flush()
    }, this.frameMs)
  }

  /** Flush immédiat (ex. avant quit) en annulant le timer en attente. */
  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.scheduled) {
      this.scheduled = false
      this.flush()
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.scheduled = false
  }
}
