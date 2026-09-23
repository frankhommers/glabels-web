/** Preferences of the installation. */

import type { UnitId } from '../editor/units'

export type PreferencesPayload = {
  locale: string
  unit: UnitId
  units: UnitId[]
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      // no JSON body
    }
    throw new Error(detail)
  }
  return (await response.json()) as T
}

export const preferences = {
  read: () => fetch('/api/preferences').then((response) => json<PreferencesPayload>(response)),

  write: (body: { locale?: string; unit?: UnitId }) =>
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((response) => json<PreferencesPayload>(response)),
}
