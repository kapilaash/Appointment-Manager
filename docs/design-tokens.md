# Colour tokens

Every theme (Studio, Classic Chess, Black & White) defines the same token names in
`frontend/src/styles/globals.css`; Tailwind exposes them in `frontend/tailwind.config.ts`.
Components use the names below and never hard-code a hue, so a new theme only needs new values.

| Use | Token | Example classes |
| --- | --- | --- |
| Page background | `canvas` | `bg-canvas` |
| Cards, panels, inputs | `surface` | `bg-surface` |
| Headings | `heading` | `text-heading` |
| Neutral text, borders, fills | `neutral-50 … 900` | `text-neutral-700`, `border-neutral-200` |
| Brand / interactive accent | `accent`, `accent-hover`, `accent-50 … 950` | `bg-accent`, `hover:bg-accent-hover`, `text-accent-700` |
| Text on an accent fill | `on-accent` | `text-on-accent` |
| Positive states | `success-50 … 900` | `bg-success-50 text-success-800` |
| Waiting / caution | `warning-50 … 950` | `bg-warning-50 text-warning-900` |
| Errors, destructive actions | `danger`, `danger-hover`, `danger-50 … 800` | `bg-danger`, `text-danger-700` |
| Always-dark backdrop (sign-in, overlays) | `ink` | `bg-ink/40` |

## Readability rules (WCAG 2.1 AA)

- Readable text uses `neutral-500` or darker (`neutral-400` and lighter are for icons, borders and disabled states).
- Small accent text uses `accent-700` or darker.
- `npm run test:visual` scans every key page in every theme with axe and fails on any contrast or labelling problem.
