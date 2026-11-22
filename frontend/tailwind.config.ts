import type { Config } from 'tailwindcss';

const shades = (color: string, values: number[]) =>
  Object.fromEntries(values.map((shade) => [shade, `rgb(var(--${color}-${shade}) / <alpha-value>)`]));

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Inter Variable"',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      colors: {
        surface: 'rgb(var(--surface) / <alpha-value>)',
        heading: 'rgb(var(--heading) / <alpha-value>)',
        action: 'rgb(var(--action) / <alpha-value>)',
        'on-action': 'rgb(var(--action-foreground) / <alpha-value>)',
        'action-hover': 'rgb(var(--action-hover) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'danger-hover': 'rgb(var(--danger-hover) / <alpha-value>)',
        slate: shades('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        indigo: shades('indigo', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        amber: shades('amber', [50, 100, 200, 300, 700, 900, 950]),
        emerald: shades('emerald', [50, 100, 600, 700, 800]),
        rose: shades('rose', [50, 200, 400, 500, 600, 700, 800]),
        red: shades('red', [50, 200, 700, 800]),
      },
      boxShadow: {
        // Soft, layered elevation for cards; lighter than Tailwind's default shadow-sm.
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.05)',
        lifted: '0 8px 24px -6px rgb(15 23 42 / 0.12), 0 2px 6px rgb(15 23 42 / 0.05)',
      },
    },
  },
  plugins: [],
} satisfies Config;
