import type { ScreenCapture } from '../shared'

/**
 * Screen capture module — Windows-first via Electron desktopCapturer.
 * Swap implementation later (DXGI, window-scoped) without touching the agent.
 */
export interface CaptureModule {
  capturePrimaryDisplay(maxWidth?: number): Promise<ScreenCapture>
  captureDisplay(displayId: string, maxWidth?: number): Promise<ScreenCapture>
}
