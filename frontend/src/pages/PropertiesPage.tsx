import { useState } from 'react'
import type { Session } from '../app/session'
import { formatLength, fromPt, toPt, UNIT_IDS, type UnitId } from '../editor/units'
import { SheetPreview } from '../components/SelectProductDialog'
import type { Template } from '../api/types'
import { canRotate, orientationOf, type Orientation } from '../editor/label'

export function PropertiesPage({
  session,
  template,
  onChangeProduct,
}: {
  session: Session
  template: Template | null
  onChangeProduct: () => void
}) {
  const t = session.t
  const { detail, unit } = session
  if (!detail) return null

  const frame = template?.frames[0]
  const layout = frame?.layouts[0]
  const size = (points: number) => `${formatLength(points, unit)} ${t(`unit.${unit}`)}`

  return (
    <div className="page-form">
      <fieldset>
        <legend>{t('properties.product')}</legend>
        <div className="form-row">
          <label>{t('properties.brand')}</label>
          <span className="form-static">{detail.template_brand}</span>
        </div>
        <div className="form-row">
          <label>{t('properties.part')}</label>
          <span className="form-static">{detail.template_part}</span>
        </div>
        <div className="form-row">
          <label>{t('properties.description')}</label>
          <span className="form-static">{detail.template_description || '—'}</span>
        </div>
        <div className="form-row">
          <label>{t('properties.pageSize')}</label>
          <span className="form-static">
            {template?.size ?? '—'}
            {template?.page_width_pt
              ? ` (${size(template.page_width_pt)} × ${size(template.page_height_pt ?? 0)})`
              : ''}
          </span>
        </div>
        <div className="form-row">
          <label>{t('properties.labelSize')}</label>
          <span className="form-static">
            {size(detail.label_width_pt)} × {size(detail.label_height_pt)}
          </span>
        </div>
        <div className="form-row">
          <label>{t('properties.layout')}</label>
          <span className="form-static">
            {layout ? t('properties.layoutValue', { nx: layout.nx, ny: layout.ny }) : '—'}
          </span>
        </div>
        <div className="form-row">
          <label />
          <button type="button" onClick={onChangeProduct} title={t('properties.changeProductHint')}>
            {t('properties.changeProduct')}
          </button>
        </div>
      </fieldset>

      {detail.content.length_pt != null ? (
        <fieldset>
          <legend>{t('properties.tape')}</legend>
          <LengthField
            key={detail.id}
            label={t('properties.length')}
            points={detail.content.length_pt}
            unit={unit}
            unitName={t(`unit.${unit}`)}
            onChange={session.setLength}
          />
          <p className="muted">
            {t('properties.lengthHint', {
              min: size(detail.label_min_length_pt ?? 0),
              max: size(detail.label_max_length_pt ?? 0),
            })}
          </p>
        </fieldset>
      ) : null}

      <fieldset>
        <legend>{t('properties.orientation')}</legend>
        <div className="form-row">
          <label />
          <select
            value={orientationOf(detail)}
            disabled={!canRotate(detail)}
            title={t('properties.orientationHint')}
            onChange={(event) => session.setOrientation(event.target.value as Orientation)}
          >
            <option value="horizontal">{t('properties.horizontal')}</option>
            <option value="vertical">{t('properties.vertical')}</option>
          </select>
        </div>
        {canRotate(detail) ? null : <p className="muted">{t('properties.orientationRound')}</p>}
      </fieldset>

      <fieldset>
        <legend>{t('properties.display')}</legend>
        <div className="form-row">
          <label>{t('properties.unit')}</label>
          <select value={unit} onChange={(event) => session.setUnit(event.target.value as UnitId)}>
            {UNIT_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`unit.${id}`)}
              </option>
            ))}
          </select>
        </div>
        <label className="check wide">
          <input type="checkbox" checked={session.showMarkup} onChange={(event) => session.setShowMarkup(event.target.checked)} />
          {t('properties.showMarkup')}
        </label>
      </fieldset>

      {template ? (
        <fieldset className="sheet-fieldset">
          <legend>{t('properties.sheetLayout')}</legend>
          <SheetPreview template={template} />
        </fieldset>
      ) : null}
    </div>
  )
}

/** The length of a tape label. Typed freely and applied on Enter or when
 *  leaving the field, so typing "120" does not pass through 1 and 12. */
function LengthField({
  label,
  points,
  unit,
  unitName,
  onChange,
}: {
  label: string
  points: number
  unit: UnitId
  unitName: string
  onChange: (points: number) => void
}) {
  const [text, setText] = useState(formatLength(points, unit))
  // A new length from elsewhere (kept within the roll, saved, another unit)
  // replaces what the field shows.
  const [shown, setShown] = useState({ points, unit })
  if (shown.points !== points || shown.unit !== unit) {
    setShown({ points, unit })
    setText(formatLength(points, unit))
  }
  const apply = (raw = text) => {
    const value = Number.parseFloat(raw.replace(',', '.'))
    if (Number.isFinite(value) && value > 0) onChange(toPt(value, unit))
    else setText(formatLength(points, unit))
  }
  return (
    <div className="form-row">
      <label>{label}</label>
      <span className="spin">
        <input
          type="number"
          value={text}
          step={unit === 'mm' ? 1 : fromPt(1, unit) < 0.1 ? 0.01 : 0.1}
          onChange={(event) => {
            setText(event.target.value)
            // The arrows of the field apply right away; typing waits.
            if (!(event.nativeEvent instanceof InputEvent)) apply(event.target.value)
          }}
          onBlur={() => apply()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
          }}
        />
        <span className="spin-suffix">{unitName}</span>
      </span>
    </div>
  )
}
