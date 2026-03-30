/**
 * Humanize a snake_case status string for display.
 * e.g. "awaiting_acceptance" → "Awaiting Acceptance"
 */
export function humanizeStatus(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
