import type { Config } from 'tailwindcss';

const shades = (color: string, values: number[]) => Object.fromEntries(
  values.map((shade) => [shade, `rgb(var(--${color}-${shade}) / <alpha-value>)`]),
);

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'rgb(var(--surface) / <alpha-value>)',
        heading: 'rgb(var(--heading) / <alpha-value>)',
        action: 'rgb(var(--action) / <alpha-value>)',
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
    },
  },
  plugins: [],
} satisfies Config;
