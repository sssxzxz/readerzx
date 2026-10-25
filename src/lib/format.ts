import type { BookFormat } from '@shared/types';

export function isReflowable(fmt: BookFormat): boolean {
  return fmt !== 'pdf';
}

export function formatLabel(fmt: BookFormat): string {
  return fmt.toUpperCase();
}
