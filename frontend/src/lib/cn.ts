import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join class names and let later Tailwind classes override earlier ones (e.g. px-4 + px-2 → px-2). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
