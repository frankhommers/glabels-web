/** Date and number formatting for the configured region.
 *
 *  The browser's language setting is not always right — a workstation may be
 *  set to English while the labels are Dutch. That is why the region is a
 *  setting of the installation; empty means: follow the browser.
 */

let current: string | undefined

export function setLocale(locale: string | null | undefined): void {
  current = locale ? locale : undefined
}

export function currentLocale(): string | undefined {
  return current
}

export function formatMoment(value: string): string {
  const moment = new Date(value)
  return Number.isNaN(moment.getTime()) ? '' : moment.toLocaleString(current)
}

export function formatDate(value: string): string {
  const moment = new Date(value)
  return Number.isNaN(moment.getTime()) ? '' : moment.toLocaleDateString(current)
}

/** Regions offered in the preferences. The empty value means: follow the
 *  browser's language setting. Their names live in the translation
 *  catalogues under `region.<code>`. */
export const LOCALES = [
  '',
  'nl-NL',
  'nl-BE',
  'en-GB',
  'en-US',
  'de-DE',
  'fr-FR',
  'es-ES',
  'it-IT',
  'da-DK',
  'sv-SE',
] as const
