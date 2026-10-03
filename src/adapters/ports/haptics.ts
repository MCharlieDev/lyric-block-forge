import type { PortCapabilities } from './common'

/**
 * 震动反馈端口。
 *
 * 使用场景：移动端横屏打轴时点大按键的触感反馈；
 * 播放头接近人声区起点时给予轻微提示。
 * 桌面与 Web 通常不支持，探测失败时静默降级，不得报错打断流程。
 *
 * 平台实现提示：
 * - Web：`navigator.vibrate`（Android Chrome 支持，iOS Safari 不支持）。
 * - Tauri 2：一般不支持，直接返回不可用。
 * - Capacitor：`@capacitor/haptics`。
 */

/** 震动强度档位。 */
export type HapticStrength = 'light' | 'medium' | 'heavy'

/**
 * 震动端口。
 */
export interface HapticsPort {
  /**
   * 探测震动能力。
   *
   * @returns 能力探测结果
   */
  canVibrate(): PortCapabilities

  /**
   * 按强度触发一次震动。
   *
   * @param strength 强度档位
   */
  impact(strength: HapticStrength): Promise<void>

  /**
   * 触发一次"选择变化"反馈，用于选中行 / 吸附对齐。
   */
  selection(): Promise<void>

  /**
   * 触发一次成功反馈，例如打轴落点成功。
   */
  success(): Promise<void>
}
