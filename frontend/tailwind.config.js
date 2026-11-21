/** @type {import('tailwindcss').Config} */
const shades = (color, values) => Object.fromEntries(
  values.map((shade) => [shade, `rgb(var(--${color}-${shade}) / <alpha-value>)`]),
);

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
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
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          500: '#0284c7',
          600: '#0369a1',
          700: '#075985',
          900: '#0c4a6e',
        },
        chess: {
          boardLight: '#f0d9b5',
          boardDark: '#b58863',
          wood: '#2c1e14'
        }
      }
    },
  },
  plugins: [],
}
