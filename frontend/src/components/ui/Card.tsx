import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-2xl border border-neutral-200/80 bg-surface shadow-card', className)} {...props} />
  );
}
