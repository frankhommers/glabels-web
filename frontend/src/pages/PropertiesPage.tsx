import type { Session } from '../app/session'
import { formatLength, UNIT_IDS, type UnitId } from '../editor/units'
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
