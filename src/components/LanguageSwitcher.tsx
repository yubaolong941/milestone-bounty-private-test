'use client'

import { SupportedLocale } from '@/lib/i18n'

type Props = {
  locale: SupportedLocale
  onChange: (locale: SupportedLocale) => void
  label: string
  englishLabel: string
  chineseLabel: string
}

export default function LanguageSwitcher({
  locale,
  onChange,
  label,
  englishLabel,
  chineseLabel
}: Props) {
  return (
    <div className="inline-flex items-center gap-2" aria-label={label}>
      <button
        type="button"
        className={`filter-chip ${locale === 'en' ? 'filter-chip-active' : ''}`}
        aria-pressed={locale === 'en'}
        onClick={() => onChange('en')}
      >
        {englishLabel}
      </button>
      <button
        type="button"
        className={`filter-chip ${locale === 'zh' ? 'filter-chip-active' : ''}`}
        aria-pressed={locale === 'zh'}
        onClick={() => onChange('zh')}
      >
        {chineseLabel}
      </button>
    </div>
  )
}
