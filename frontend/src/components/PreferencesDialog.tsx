/** Preferences of this installation. */

import { useState } from 'react'
import { preferences as api } from '../api/preferences'
import { LOCALES, setLocale } from '../app/locale'
import { useT } from '../i18n'
import { UNIT_IDS, type UnitId } from '../editor/units'

export function PreferencesDialog({
  locale,
  unit,
  onSaved,
  onClose,
}: {
  locale: string
  unit: UnitId
  onSaved: (values: { locale: string; unit: UnitId }) => void
  onClose: () => void
}) {
  const t = useT()
  const [chosenLocale, setChosenLocale] = useState(locale)
  const [chosenUnit, setChosenUnit] = useState<UnitId>(unit)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const example = new Date().toLocaleString(chosenLocale || undefined)

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const saved = await api.write({ locale: chosenLocale, unit: chosenUnit })
      setLocale(saved.locale)
      onSaved({ locale: saved.locale, unit: saved.unit })
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-label={t('preferences.title')}>
      <div className="modal preferences">
        <div className="modal-title">{t('preferences.title')}</div>
        <div className="modal-body">
          <fieldset>
            <legend>{t('preferences.region')}</legend>
            <div className="form-row">
              <label>{t('preferences.format')}</label>
              <select value={chosenLocale} onChange={(event) => setChosenLocale(event.target.value)}>
                {LOCALES.some((code) => code === chosenLocale) ? null : (
                  <option value={chosenLocale}>{chosenLocale}</option>
                )}
                {LOCALES.map((code) => (
                  <option key={code} value={code}>
                    {t(code === '' ? 'region.browser' : `region.${code}`)}
                  </option>
                ))}
              </select>
            </div>
            <p className="muted">{t('preferences.example', { example })}</p>
            <p className="muted">{t('preferences.languageNote')}</p>
            <p className="inline-notice">{t('preferences.serverWide')}</p>
          </fieldset>

          <fieldset>
            <legend>{t('preferences.measurements')}</legend>
            <div className="form-row">
              <label>{t('preferences.unit')}</label>
              <select
                value={chosenUnit}
                onChange={(event) => setChosenUnit(event.target.value as UnitId)}
              >
                {UNIT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`unit.${id}`)}
                  </option>
                ))}
              </select>
            </div>
            <p className="muted">{t('preferences.unitHint')}</p>
          </fieldset>

          {problem ? <p className="inline-warning">{problem}</p> : null}
        </div>
        <div className="modal-buttons">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="default" disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
