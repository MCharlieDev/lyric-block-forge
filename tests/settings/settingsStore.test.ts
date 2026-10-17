/**
 * 设置存储 · 元数据前缀规则表测试。
 *
 * 覆盖四类契约：
 * 1. 默认值：9 条默认规则，且与内核常量不共享引用；
 * 2. 持久化读回：合法条目 trim 后保留，空数组保持 `[]`；
 * 3. 脏数据：逐条丢弃非法条目，`action` 非法降级为 `meta`；
 * 4. 映射与重置：`toMetadataPrefixOptions` 透传规则表，`reset` 恢复默认且无共享引用。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  toMetadataPrefixOptions,
  useSettingsStore,
} from '../../src/ui/stores/settingsStore'

/** 默认规则条数（与 core 的 `DEFAULT_METADATA_PREFIX_RULES` 保持一致）。 */
const DEFAULT_RULE_COUNT = 9

beforeEach(() => {
  useSettingsStore.getState().reset()
})

describe('settingsStore · metadataPrefixRules', () => {
  it('默认设置包含 9 条前缀规则', () => {
    const rules = useSettingsStore.getState().settings.metadataPrefixRules
    expect(rules).toHaveLength(DEFAULT_RULE_COUNT)
    expect(rules[0]).toEqual({ prefix: '作词', tag: 'lyricist' })
  })

  it('hydrate 合法规则时保留并 trim', () => {
    useSettingsStore.getState().hydrate({
      metadataPrefixRules: [{ prefix: ' 词 ', tag: ' lyricist ', action: 'line' }],
    })

    expect(useSettingsStore.getState().settings.metadataPrefixRules).toEqual([
      { prefix: '词', tag: 'lyricist', action: 'line' },
    ])
  })

  it('非数组回退默认表 clone，空数组保持空', () => {
    useSettingsStore.getState().hydrate({ metadataPrefixRules: 'oops' })
    const fallback = useSettingsStore.getState().settings.metadataPrefixRules
    expect(fallback).toHaveLength(DEFAULT_RULE_COUNT)
    expect(fallback).not.toBe(DEFAULT_SETTINGS.metadataPrefixRules)
    expect(fallback[0]).not.toBe(DEFAULT_SETTINGS.metadataPrefixRules[0])

    useSettingsStore.getState().hydrate({ metadataPrefixRules: [] })
    expect(useSettingsStore.getState().settings.metadataPrefixRules).toEqual([])
  })

  it('脏条目逐条丢弃，action 非法降级为 meta', () => {
    useSettingsStore.getState().hydrate({
      metadataPrefixRules: [
        { tag: 'lyricist' }, // 缺 prefix
        { prefix: '作曲' }, // 缺 tag
        { prefix: '作曲', tag: 'composer2' }, // tag 含数字
        { prefix: '作曲', tag: 'composer_x' }, // tag 含下划线
        { prefix: '作:词', tag: 'lyricist' }, // prefix 含英文冒号
        { prefix: '作：词', tag: 'lyricist' }, // prefix 含中文冒号
        { prefix: '作 词', tag: 'lyricist' }, // prefix 含空格
        { prefix: '演唱', tag: 'ar', action: 'other' }, // action 非法 → meta
        null,
        'x',
      ],
    })

    expect(useSettingsStore.getState().settings.metadataPrefixRules).toEqual([
      { prefix: '演唱', tag: 'ar', action: 'meta' },
    ])
  })

  it('toMetadataPrefixOptions 透传 rules', () => {
    useSettingsStore.getState().hydrate({
      metadataPrefixMode: 'meta',
      metadataPrefixRules: [{ prefix: '词', tag: 'lyricist', action: 'meta' }],
    })

    const settings = useSettingsStore.getState().settings
    const options = toMetadataPrefixOptions(settings)
    expect(options.enabled).toBe(true)
    expect(options.keepLyricLine).toBe(false)
    expect(options.rules).toBe(settings.metadataPrefixRules)
    expect(options.rules).toEqual([{ prefix: '词', tag: 'lyricist', action: 'meta' }])
  })

  it('遮罩关闭前缀弹窗默认关闭，非布尔输入回退默认', () => {
    expect(
      useSettingsStore.getState().settings.closeMetadataPrefixDialogOnBackdropClick,
    ).toBe(false)

    useSettingsStore.getState().hydrate({ closeMetadataPrefixDialogOnBackdropClick: 'yes' })
    expect(
      useSettingsStore.getState().settings.closeMetadataPrefixDialogOnBackdropClick,
    ).toBe(false)

    useSettingsStore.getState().hydrate({ closeMetadataPrefixDialogOnBackdropClick: true })
    expect(
      useSettingsStore.getState().settings.closeMetadataPrefixDialogOnBackdropClick,
    ).toBe(true)
  })

  it('reset 恢复默认且不与 DEFAULT_SETTINGS 共享引用', () => {
    const first = useSettingsStore.getState().settings.metadataPrefixRules
    first[0].prefix = '被篡改'

    useSettingsStore.getState().reset()
    const second = useSettingsStore.getState().settings.metadataPrefixRules

    expect(second[0].prefix).toBe('作词')
    expect(second).not.toBe(DEFAULT_SETTINGS.metadataPrefixRules)
    expect(second[0]).not.toBe(DEFAULT_SETTINGS.metadataPrefixRules[0])
  })
})
