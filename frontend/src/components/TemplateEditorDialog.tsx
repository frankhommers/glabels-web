/** Create or update a user product definition.
 *
 *  Deliberately a form and not an XML editor: the sheet layout is where
 *  things go wrong, so it sits next to a sheet preview that shows right away
 *  whether it is right. The definition is stored as a separate XML file in
 *  the shared folder, in the same shape as the bundled database.
 */

import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Frame, PaperSize, Template } from '../api/types'
import { fromPt, toPt, type UnitId } from '../editor/units'
import { useT } from '../i18n'
import { NumberField } from '../ui/NumberField'
import { SheetPreview } from './SelectProductDialog'

const SHAPES: Frame['shape'][] = ['rectangle', 'round', 'ellipse', 'cd', 'continuous']

const EMPTY: Template = {
  brand: '',
  part: '',
  description: '',
  size: 'A4',
  page_width_pt: toPt(210, 'mm'),
  page_height_pt: toPt(297, 'mm'),
  roll_width_pt: 0,
  categories: [],
  product_url: null,
  equiv_part: null,
  source: 'user',
  frames: [
    {
      id: '0',
      shape: 'rectangle',
      width_pt: toPt(63.5, 'mm'),
      height_pt: toPt(38.1, 'mm'),
      radius_pt: null,
      hole_pt: null,
      round_pt: 0,
      x_waste_pt: 0,
      y_waste_pt: 0,
      min_height_pt: null,
      max_height_pt: null,
      default_height_pt: null,
      markups: [{ type: 'margin', values: { size: toPt(1.5, 'mm') } }],
      layouts: [
        {
          nx: 3,
          ny: 7,
          x0_pt: toPt(7.2, 'mm'),
          y0_pt: toPt(15.1, 'mm'),
          dx_pt: toPt(66, 'mm'),
          dy_pt: toPt(38.1, 'mm'),
        },
      ],
    },
  ],
}

export function TemplateEditorDialog({
  base,
  unit,
  onSaved,
  onCancel,
}: {
  /** Starting point: an existing product to derive from, or nothing. */
  base: Template | null
  unit: UnitId
  onSaved: (template: Template) => void
  onCancel: () => void
}) {
  const t = useT()
  const editingOwn = base?.source === 'user'
  const [template, setTemplate] = useState<Template>(() => {
    if (!base) return structuredClone(EMPTY)
    const copy = structuredClone(base)
    if (!editingOwn) {
      // Deriving from a bundled product: the part number must be new,
      // otherwise you would be trying to overwrite the upstream definition.
      copy.part = `${base.part}-custom`
      copy.description = base.description
    }
    copy.source = 'user'
    return copy
  })
  const [paperSizes, setPaperSizes] = useState<PaperSize[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/templates/paper-sizes')
      .then((response) => response.json())
      .then(setPaperSizes)
      .catch(() => setPaperSizes([]))
  }, [])

  const frame = template.frames[0]
  const layout = frame.layouts[0]
  const u = t(`unit.${unit}`)
  const len = (points: number | null | undefined) => fromPt(points ?? 0, unit)

  const update = (change: Partial<Template>) => setTemplate({ ...template, ...change })

  const updateFrame = (change: Partial<Frame>) =>
    setTemplate({ ...template, frames: [{ ...frame, ...change }, ...template.frames.slice(1)] })

  const updateLayout = (change: Partial<typeof layout>) =>
    updateFrame({ layouts: [{ ...layout, ...change }, ...frame.layouts.slice(1)] })

  const margin = frame.markups.find((markup) => markup.type === 'margin')
  const marginPt = margin?.values.size ?? margin?.values.x_size ?? 0

  const updateMargin = (value: number) =>
    updateFrame({
      markups: [
        { type: 'margin', values: { size: toPt(value, unit) } },
        ...frame.markups.filter((markup) => markup.type !== 'margin'),
      ],
    })

  const choosePaper = (id: string) => {
    if (id === 'Other') {
      update({ size: 'Other' })
      return
    }
    const paper = paperSizes.find((item) => item.id === id)
    if (!paper) return
    update({ size: id, page_width_pt: paper.width_pt, page_height_pt: paper.height_pt })
  }

  /** Warnings the user sees before saving. */
  const warnings = useMemo(() => {
    const list: string[] = []
    const width =
      frame.shape === 'round' || frame.shape === 'cd'
        ? (frame.radius_pt ?? 0) * 2
        : (frame.width_pt ?? 0)
    const height =
      frame.shape === 'round' || frame.shape === 'cd'
        ? (frame.radius_pt ?? 0) * 2
        : (frame.height_pt ?? frame.default_height_pt ?? 0)

    if (width <= 0 || height <= 0) list.push(t('definition.noSize'))
    if (layout.nx > 1 && layout.dx_pt < width)
      list.push(t('definition.overlapHorizontal'))
    if (layout.ny > 1 && layout.dy_pt < height)
      list.push(t('definition.overlapVertical'))

    const right = layout.x0_pt + layout.dx_pt * (layout.nx - 1) + width
    const bottom = layout.y0_pt + layout.dy_pt * (layout.ny - 1) + height
    if (right > (template.page_width_pt ?? 0) + 1)
      list.push(t('definition.outsideRight'))
    if (bottom > (template.page_height_pt ?? 0) + 1)
      list.push(t('definition.outsideBottom'))
    return list
  }, [frame, layout, template.page_width_pt, template.page_height_pt, t])

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const saved = await api.saveTemplate(template)
      onSaved(saved)
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const round = frame.shape === 'round' || frame.shape === 'cd'

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-label={t(editingOwn ? 'definition.titleEdit' : 'definition.titleNew')}>
      <div className="modal template-editor">
        <div className="modal-title">
          {t(editingOwn ? 'definition.titleEdit' : 'definition.titleNew')}
        </div>

        <div className="modal-body template-body">
          <div className="template-form">
            <fieldset>
              <legend>{t('definition.product')}</legend>
              <div className="form-row">
                <label>{t('definition.brand')}</label>
                <input value={template.brand} onChange={(event) => update({ brand: event.target.value })} />
              </div>
              <div className="form-row">
                <label>{t('definition.part')}</label>
                <input value={template.part} onChange={(event) => update({ part: event.target.value })} />
              </div>
              <div className="form-row">
                <label>{t('definition.description')}</label>
                <input
                  value={template.description}
                  onChange={(event) => update({ description: event.target.value })}
                />
              </div>
              <div className="form-row">
                <label>{t('definition.paperSize')}</label>
                <select value={template.size ?? 'Other'} onChange={(event) => choosePaper(event.target.value)}>
                  {paperSizes.map((paper) => (
                    <option key={paper.id} value={paper.id}>
                      {paper.name}
                    </option>
                  ))}
                  <option value="Other">{t('definition.other')}</option>
                </select>
              </div>
              {(template.size ?? 'Other') === 'Other' ? (
                <>
                  <NumberField
                    label={t('definition.paperWidth')}
                    suffix={u}
                    value={len(template.page_width_pt)}
                    onChange={(value) => update({ page_width_pt: toPt(value, unit) })}
                  />
                  <NumberField
                    label={t('definition.paperHeight')}
                    suffix={u}
                    value={len(template.page_height_pt)}
                    onChange={(value) => update({ page_height_pt: toPt(value, unit) })}
                  />
                </>
              ) : null}
            </fieldset>

            <fieldset>
              <legend>{t('definition.label')}</legend>
              <div className="form-row">
                <label>{t('definition.shape')}</label>
                <select
                  value={frame.shape}
                  onChange={(event) => updateFrame({ shape: event.target.value as Frame['shape'] })}
                >
                  {SHAPES.map((shape) => (
                    <option key={shape} value={shape}>
                      {t(`definition.shape.${shape}`)}
                    </option>
                  ))}
                </select>
              </div>

              {round ? (
                <>
                  <NumberField
                    label={t('definition.radius')}
                    suffix={u}
                    value={len(frame.radius_pt)}
                    onChange={(value) => updateFrame({ radius_pt: toPt(value, unit) })}
                  />
                  {frame.shape === 'cd' ? (
                    <NumberField
                      label={t('definition.hole')}
                      suffix={u}
                      value={len(frame.hole_pt)}
                      onChange={(value) => updateFrame({ hole_pt: toPt(value, unit) })}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <NumberField
                    label={t('definition.width')}
                    suffix={u}
                    value={len(frame.width_pt)}
                    onChange={(value) => updateFrame({ width_pt: toPt(value, unit) })}
                  />
                  {frame.shape === 'continuous' ? (
                    <NumberField
                      label={t('definition.defaultHeight')}
                      suffix={u}
                      value={len(frame.default_height_pt)}
                      onChange={(value) =>
                        updateFrame({
                          default_height_pt: toPt(value, unit),
                          min_height_pt: frame.min_height_pt ?? toPt(value / 2, unit),
                          max_height_pt: frame.max_height_pt ?? toPt(value * 4, unit),
                        })
                      }
                    />
                  ) : (
                    <NumberField
                      label={t('definition.height')}
                      suffix={u}
                      value={len(frame.height_pt)}
                      onChange={(value) => updateFrame({ height_pt: toPt(value, unit) })}
                    />
                  )}
                </>
              )}

              {frame.shape === 'rectangle' ? (
                <NumberField
                  label={t('definition.cornerRadius')}
                  suffix={u}
                  value={len(frame.round_pt)}
                  onChange={(value) => updateFrame({ round_pt: toPt(value, unit) })}
                />
              ) : null}

              <NumberField
                label={t('definition.margin')}
                suffix={u}
                value={fromPt(marginPt, unit)}
                onChange={updateMargin}
              />
            </fieldset>

            <fieldset>
              <legend>{t('definition.sheetLayout')}</legend>
              <NumberField
                label={t('definition.columns')}
                value={layout.nx}
                step={1}
                min={1}
                onChange={(value) => updateLayout({ nx: Math.max(1, Math.round(value)) })}
              />
              <NumberField
                label={t('definition.rows')}
                value={layout.ny}
                step={1}
                min={1}
                onChange={(value) => updateLayout({ ny: Math.max(1, Math.round(value)) })}
              />
              <NumberField
                label={t('definition.marginLeft')}
                suffix={u}
                value={len(layout.x0_pt)}
                onChange={(value) => updateLayout({ x0_pt: toPt(value, unit) })}
              />
              <NumberField
                label={t('definition.marginTop')}
                suffix={u}
                value={len(layout.y0_pt)}
                onChange={(value) => updateLayout({ y0_pt: toPt(value, unit) })}
              />
              <NumberField
                label={t('definition.pitchHorizontal')}
                suffix={u}
                value={len(layout.dx_pt)}
                onChange={(value) => updateLayout({ dx_pt: toPt(value, unit) })}
              />
              <NumberField
                label={t('definition.pitchVertical')}
                suffix={u}
                value={len(layout.dy_pt)}
                onChange={(value) => updateLayout({ dy_pt: toPt(value, unit) })}
              />
              <p className="muted">{t('definition.pitchHint')}</p>
            </fieldset>
          </div>

          <div className="template-preview">
            <h3>{t('definition.sheetPreview')}</h3>
            <SheetPreview template={template} />
            <p className="muted">
              {t('definition.perSheet', {
                nx: layout.nx,
                ny: layout.ny,
                total: layout.nx * layout.ny,
              })}
            </p>
            {warnings.map((warning) => (
              <p key={warning} className="inline-notice">
                {warning}
              </p>
            ))}
            {problem ? <p className="inline-warning">{problem}</p> : null}
            <p className="muted">{t('definition.storageHint')}</p>
          </div>
        </div>

        <div className="modal-buttons">
          <span className="spacer" />
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="default"
            disabled={busy || !template.brand.trim() || !template.part.trim()}
            onClick={() => void save()}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
