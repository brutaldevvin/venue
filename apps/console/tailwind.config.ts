import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        indigo: '#1e1ebe',
        'indigo-deep': '#16169a',
        ground: '#f5f5fa',
        card: '#ffffff',
        'on-indigo': '#ffffff',
        body: '#4a4a7a',
        muted: '#8a8ab5',
        line: '#d9d9ec',
        bound: '#e97366',
      },
      fontFamily: {
        ui: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { sm: '4px', md: '6px', lg: '10px' },
    },
  },
  plugins: [],
} satisfies Config
