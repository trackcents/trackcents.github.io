// shadcn-svelte's standard utility for conditional class composition.
// Required by the component primitives shadcn-svelte generates.
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
