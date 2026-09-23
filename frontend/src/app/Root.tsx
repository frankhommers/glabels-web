/** What surrounds the application: preferences, language and dialogs.
 *
 *  Preferences are fetched first, because they decide the interface
 *  language. Only then is the application built; otherwise it would first
 *  appear in the wrong language and switch right away.
 */

import { useEffect, useState } from 'react'
import { preferences as preferencesApi } from '../api/preferences'
import App from '../App'
import { MobileApp } from '../mobile/MobileApp'
import { MOBILE_BASE, isPhone, prefersDesktop } from '../mobile/view'
import { TranslationProvider } from '../i18n'
import { DialogProvider } from '../ui/dialogs'
import { setLocale } from './locale'
import type { UnitId } from '../editor/units'

export type Preferences = { locale: string; unit: UnitId }

const DEFAULTS: Preferences = { locale: '', unit: 'mm' }

/** The phone view for `/m`, and for a phone that opens the start page —
 *  unless the user chose the full editor on this device. */
function wantsMobile(): boolean {
  const path = window.location.pathname
  if (path === MOBILE_BASE || path.startsWith(`${MOBILE_BASE}/`)) return true
  if (path === '/' && isPhone() && !prefersDesktop()) {
    window.history.replaceState(null, '', MOBILE_BASE)
    return true
  }
  return false
}

export function Root() {
  const [mobile] = useState(wantsMobile)
  const [preferences, setPreferences] = useState<Preferences | null>(null)

  useEffect(() => {
    preferencesApi
      .read()
      .then((values) => {
        setLocale(values.locale)
        setPreferences({ locale: values.locale, unit: values.unit })
      })
      .catch(() => setPreferences(DEFAULTS))
  }, [])

  if (!preferences) return null

  return (
    <TranslationProvider locale={preferences.locale || undefined}>
      {mobile ? (
        <MobileApp />
      ) : (
        <DialogProvider>
          <App
            preferences={preferences}
            onPreferencesChange={(values) => {
              setLocale(values.locale)
              setPreferences(values)
            }}
          />
        </DialogProvider>
      )}
    </TranslationProvider>
  )
}
