import { ElectronAPI } from '@electron-toolkit/preload'
import type { PrismApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    prism: PrismApi
  }
}
