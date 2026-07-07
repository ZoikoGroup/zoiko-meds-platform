import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
/** Merge Tailwind classes with correct precedence + conditional class support. */
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
