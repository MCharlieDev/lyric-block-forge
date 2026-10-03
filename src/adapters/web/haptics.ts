import type { HapticStrength, HapticsPort, PortCapabilities } from '../ports'

/** 各强度档位对应的震动时长（毫秒）。 */
const IMPACT_DURATION: Record<HapticStrength, number> = { light: 10, medium: 25, heavy: 40 }

/**
 * 创建 Web 端震动端口（`navigator.vibrate`）。
 *
 * 仅 Android Chrome 支持，iOS Safari 与桌面浏览器会探测失败；
 * 失败时静默降级，不影响任何编辑流程。
 *
 * @returns 震动端口实例
 */
export function createWebHapticsPort(): HapticsPort {
  const canVibrate = (): boolean =>
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

  const buzz = (pattern: number | number[]): void => {
    if (canVibrate()) navigator.vibrate(pattern)
  }

  return {
    canVibrate(): PortCapabilities {
      return canVibrate()
        ? { supported: true }
        : { supported: false, reason: '当前设备不支持震动反馈' }
    },

    async impact(strength: HapticStrength): Promise<void> {
      buzz(IMPACT_DURATION[strength])
    },

    async selection(): Promise<void> {
      buzz(8)
    },

    async success(): Promise<void> {
      buzz([12, 40, 24])
    },
  }
}
