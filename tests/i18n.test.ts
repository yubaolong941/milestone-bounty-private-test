import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, messages, resolveInitialLocale, translate } from '@/lib/i18n'

describe('i18n locale resolution', () => {
  it('prefers saved locale over browser locale', () => {
    expect(resolveInitialLocale({ storedLocale: 'zh-CN', browserLocale: 'en-US' })).toBe('zh')
  })

  it('falls back from browser locale to the default locale', () => {
    expect(resolveInitialLocale({ browserLocale: 'zh-Hans-CN' })).toBe('zh')
    expect(resolveInitialLocale({ storedLocale: 'fr-FR', browserLocale: 'de-DE' })).toBe(DEFAULT_LOCALE)
  })
})

describe('i18n translation', () => {
  it('returns Chinese login copy', () => {
    expect(translate('zh', 'login.selectRole')).toBe('选择角色')
  })

  it('interpolates template values', () => {
    expect(translate('en', 'external.visibleTasks', { count: 3 })).toBe('3 visible tasks')
  })

  it('falls back to English when a locale entry is missing', () => {
    const key = 'external.visibleTasks'
    const previous = messages.zh[key]
    delete (messages.zh as Record<string, string>)[key]

    try {
      expect(translate('zh', key, { count: 2 })).toBe('2 visible tasks')
    } finally {
      ;(messages.zh as Record<string, string>)[key] = previous
    }
  })
})
