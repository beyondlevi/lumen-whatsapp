import type {EvolutionErrorKind} from './evolution/client';
import {t, type StringKey} from './i18n/strings';

const FAILURE_REASONS: Record<EvolutionErrorKind, StringKey> = {
  network: 'reasonNetwork',
  auth: 'reasonAuth',
  instance: 'reasonInstance',
  rejected: 'reasonRejected',
  server: 'reasonServer',
};

/** Short reason for a failed server call, for toasts and error copy. */
export function failureReason(error: unknown): string {
  const kind = error instanceof Error && 'kind' in error ? String(error.kind) : '';
  return t(kind in FAILURE_REASONS ? FAILURE_REASONS[kind as EvolutionErrorKind] : 'reasonServer');
}
