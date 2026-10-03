import type { AdapterContext } from '..'

export { createWebAudioPort } from './audio'
export { createWebAudioAnalysisPort } from './audio-analysis'
export { createWebClipboardPort } from './clipboard'
export { createWebFilePort } from './file'
export { createWebHapticsPort } from './haptics'
export { createWebNotificationPort } from './notification'
export { createWebSharePort } from './share'
export { createWebStoragePort } from './storage'
export { createWebWaveformCachePort } from './waveform-cache'

import { createWebAudioPort } from './audio'
import { createWebAudioAnalysisPort } from './audio-analysis'
import { createWebClipboardPort } from './clipboard'
import { createWebFilePort } from './file'
import { createWebHapticsPort } from './haptics'
import { createWebNotificationPort } from './notification'
import { createWebSharePort } from './share'
import { createWebStoragePort } from './storage'
import { createWebWaveformCachePort } from './waveform-cache'

/**
 * 组装 Web 端的全部平台能力。
 *
 * Web 壳（`src/shells/web`）调用本函数得到 {@link AdapterContext} 并注入应用；
 * 桌面壳与移动壳用各自的实现替换其中若干项即可，ui 层无需任何改动。
 *
 * @returns Web 端适配器集合
 */
export function createWebAdapters(): AdapterContext {
  return {
    file: createWebFilePort(),
    audio: createWebAudioPort(),
    storage: createWebStoragePort(),
    clipboard: createWebClipboardPort(),
    share: createWebSharePort(),
    notification: createWebNotificationPort(),
    haptics: createWebHapticsPort(),
    waveformCache: createWebWaveformCachePort(),
    audioAnalysis: createWebAudioAnalysisPort(),
  }
}
