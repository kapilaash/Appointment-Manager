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
        // Roles
        canvas: 'rgb(var(--neutral-50) / <alpha-value>)', // page background
        surface: 'rgb(var(--surface) / <alpha-value>)', // cards, panels, inputs
        heading: 'rgb(var(--heading) / <alpha-value>)', // page and section headings
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)', // text/icons on accent fills
        ink: '#020617', // always-dark backdrop (sign-in screen, overlays); not themed
        // Meaning-named scales: every theme defines its own values for these.
        neutral: shades('neutral', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          ...shades('accent', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        },
        success: shades('success', [50, 100, 200, 600, 700, 800, 900]),
        warning: shades('warning', [50, 100, 200, 300, 500, 700, 900, 950]),
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          hover: 'rgb(var(--danger-hover) / <alpha-value>)',
          ...shades('danger', [50, 200, 400, 500, 600, 700, 800]),
        },
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
