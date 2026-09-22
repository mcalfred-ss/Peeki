import type { PeekiApi } from './index'

declare global {
  interface Window {
    peeki: PeekiApi
  }
}

export {}
