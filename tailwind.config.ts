import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#07070A',
          900: '#0A0A0E',
          850: '#0E0E13',
          800: '#131318',
          750: '#17171E',
          700: '#1D1D25',
          600: '#26262F',
          500: '#33333E',
        },
        gold: {
          50: '#FBF6EA',
          100: '#F4E9CD',
          200: '#EBD9A9',
          300: '#DFC68A',
          400: '#D2B479',
          500: '#C5A059',
          600: '#A9853F',
          700: '#84662C',
        },
        ink: {
          100: '#F2F2F4',
          200: '#D9D9DE',
          300: '#B4B4BE',
          400: '#8C8C99',
          500: '#6B6B78',
        },
        ok: '#3FB68B',
        warn: '#E0A23C',
        danger: '#D9636B',
        info: '#6E9FE0',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 32px -18px rgba(0,0,0,0.9)',
        gold: '0 0 0 1px rgba(197,160,89,0.28), 0 8px 28px -14px rgba(197,160,89,0.35)',
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: { fadeUp: 'fadeUp .28s ease-out both' },
    },
  },
  plugins: [],
};
export default config;
