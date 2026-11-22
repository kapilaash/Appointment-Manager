import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

const variants: Record<Variant, string> = {
  primary: 'bg-action text-on-action shadow-sm hover:bg-action-hover hover:shadow focus-visible:ring-indigo-500',
  secondary: 'bg-surface text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:ring-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-danger text-white shadow-sm hover:bg-danger-hover focus-visible:ring-rose-500',
};

/**
 * Defaults to type="button" so a button inside a form never submits it by accident;
 * pass type="submit" explicitly for submit buttons.
 */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
