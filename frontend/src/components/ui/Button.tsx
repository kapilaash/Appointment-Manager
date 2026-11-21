import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' };

const variants = {
  primary: 'bg-action text-white shadow-sm hover:bg-action-hover focus-visible:ring-indigo-500',
  secondary: 'bg-surface text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-danger text-white hover:bg-danger-hover focus-visible:ring-rose-500',
};

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  return <button className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition active:scale-[.98] motion-reduce:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`} {...props} />;
}
