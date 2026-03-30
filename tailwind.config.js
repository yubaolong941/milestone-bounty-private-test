/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          'var(--font-inter)',
          'Inter',
          '"Segoe UI"',
          'system-ui',
          'sans-serif'
        ]
      },
      colors: {
        apple: {
          blue:    '#0A84FF',
          green:   '#30D158',
          red:     '#FF453A',
          orange:  '#FF9F0A',
          yellow:  '#FFD60A',
          purple:  '#BF5AF2',
          cyan:    '#64D2FF',
        }
      },
      borderRadius: {
        'apple-sm': '8px',
        'apple':    '12px',
        'apple-lg': '16px',
        'apple-xl': '20px',
      }
    }
  },
  plugins: []
}
