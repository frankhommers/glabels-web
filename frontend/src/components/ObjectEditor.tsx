/** Object properties, with the same tabs and groups as the desktop app:
 *  Text, Barcode, Image, Line/Fill, Position/Size and Shadow. */

import { useEffect, useState } from 'react'
import type { DocumentObject } from '../api/types'
import { Icon } from '../ui/Icon'

import { fromPt, toPt, type UnitId } from '../editor/units'
import { useT, type MessageKey } from '../i18n'

const BARCODE_STYLES: { backend: string; style: string; label: MessageKey }[] = [
  { backend: 'zint', style: 'code128', label: 'barcode.code128' },
  { backend: 'zint', style: 'code39', label: 'barcode.code39' },
  { backend: 'zint', style: 'ean-13', label: 'barcode.ean13' },
  { backend: 'zint', style: 'upc-a', label: 'barcode.upca' },
  { backend: 'zint', style: 'qrcode', label: 'barcode.qrcode' },
  { backend: 'zint', style: 'datamatrix', label: 'barcode.datamatrix' },
  { backend: 'libqrencode', style: 'qrcode', label: 'barcode.qrcodeLibqrencode' },
  { backend: '', style: 'postnet', label: 'barcode.postnet' },
  { backend: '', style: 'datamatrix', label: 'barcode.datamatrixBuiltin' },
]

type TabId = 'text' | 'barcode' | 'image' | 'linefill' | 'geometry' | 'shadow'

function tabsFor(object: DocumentObject | null): TabId[] {
  if (!object) return []
  switch (object.type) {
    case 'text':
      return ['text', 'geometry', 'shadow']
    case 'barcode':
      return ['barcode', 'geometry']
    case 'image':
      return ['image', 'geometry', 'shadow']
    case 'box':
    case 'ellipse':
    case 'line':
      return ['linefill', 'geometry', 'shadow']
    default:
      return ['geometry']
  }
}

function Spin({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  suffix,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  disabled?: boolean
}) {
  return (
    <span className="spin">
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
      {suffix ? <span className="spin-suffix">{suffix}</span> : null}
    </span>
  )
}

function ColorButton({
  value,
  onChange,
  allowNone = true,
}: {
  value: string
  onChange: (value: string) => void
  allowNone?: boolean
}) {
  const t = useT()
  const rgb = value.slice(0, 7)
  const alpha = value.length === 9 ? Number.parseInt(value.slice(7), 16) : 255
  return (
    <span className="color-button">
      <label className="color-swatch" style={{ background: alpha === 0 ? 'transparent' : rgb }}>
        <input
          type="color"
          value={rgb}
          onChange={(event) => onChange(`${event.target.value}${alpha.toString(16).padStart(2, '0')}`)}
        />
        {alpha === 0 ? <span className="color-none">/</span> : null}
      </label>
      {allowNone ? (
        <label className="check">
          <input
            type="checkbox"
            checked={alpha === 0}
            onChange={(event) => onChange(`${rgb}${event.target.checked ? '00' : 'ff'}`)}
          />
          {t('objectEditor.noColor')}
        </label>
      ) : null}
    </span>
  )
}

export type ObjectEditorProps = {
  objects: DocumentObject[]
  selection: string[]
  unit: UnitId
  fontFamilies: string[]
  onChange: (id: string, patch: Partial<DocumentObject>) => void
}

export function ObjectEditor({ objects, selection, unit, fontFamilies, onChange }: ObjectEditorProps) {
  const t = useT()
  const selected = objects.filter((object) => object.id && selection.includes(object.id))
  const object = selected.length === 1 ? selected[0] : null
  const tabs = tabsFor(object)
  const [tab, setTab] = useState<TabId>('geometry')

  // For another object the editor starts on the first tab again, like the
  // desktop app does: text for text, barcode for a barcode.
  const objectKey = object ? `${object.id}:${object.type}` : ''
  const [shownFor, setShownFor] = useState('')
  useEffect(() => {
    if (tabs.length === 0) return
    if (objectKey !== shownFor) {
      setShownFor(objectKey)
      setTab(tabs[0])
    } else if (!tabs.includes(tab)) {
      setTab(tabs[0])
    }
  }, [objectKey, shownFor, tabs, tab])

  const patch = (values: Partial<DocumentObject>) => {
    if (object?.id) onChange(object.id, values)
  }
  const len = (points: number) => Number(fromPt(points, unit).toFixed(4))
  const u = t(`unit.${unit}`)

  return (
    <div className="object-editor">
      <div className="object-editor-title">
        <Icon name="glabels-object-properties" size={24} />
        <span>{object ? t(`object.${object.type}`) : t('objectEditor.title')}</span>
      </div>

      {!object ? (
        <p className="placeholder">
          {selected.length > 1
            ? t('objectEditor.multipleSelection', { count: selected.length })
            : t('objectEditor.noSelection')}
        </p>
      ) : (
        <>
          <div className="tabs" role="tablist">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'tab active' : 'tab'}
                onClick={() => setTab(id)}
              >
                {t(`objectEditor.tab.${id}`)}
              </button>
            ))}
          </div>

          <div className="tab-body">
            {object.type === 'unsupported' ? (
              <p className="inline-warning">{t('objectEditor.unsupported', { tag: object.tag })}</p>
            ) : null}

            {tab === 'text' && object.type === 'text' ? (
              <>
                <fieldset>
                  <legend>{t('objectEditor.layout')}</legend>
                  <div className="form-row">
                    <label>{t('objectEditor.alignment')}</label>
                    <span className="toggle-group">
                      {(['left', 'center', 'right'] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={object.align === value ? 'icon-toggle active' : 'icon-toggle'}
                          title={t(({ left: 'objectEditor.left', center: 'objectEditor.centered', right: 'objectEditor.right' } as const)[value])}
                          onClick={() => patch({ align: value } as Partial<DocumentObject>)}
                        >
                          <Icon name={`glabels-align-text-${value}`} size={22} />
                        </button>
                      ))}
                      <span className="toggle-gap" />
                      {(['top', 'middle', 'bottom'] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            (value === 'middle' ? 'center' : value) === object.valign
                              ? 'icon-toggle active'
                              : 'icon-toggle'
                          }
                          title={t(({ top: 'objectEditor.top', middle: 'objectEditor.middle', bottom: 'objectEditor.bottom' } as const)[value])}
                          onClick={() =>
                            patch({ valign: value === 'middle' ? 'center' : value } as Partial<DocumentObject>)
                          }
                        >
                          <Icon name={`glabels-valign-text-${value}`} size={22} />
                        </button>
                      ))}
                    </span>
                  </div>
                  <div className="form-row">
                    <label>{t('objectEditor.lineSpacing')}</label>
                    <Spin value={object.line_spacing} step={0.05} min={0.1} onChange={(value) => patch({ line_spacing: value } as Partial<DocumentObject>)} />
                  </div>
                  <div className="form-row">
                    <label>{t('objectEditor.wrap')}</label>
                    <select value={object.wrap} onChange={(event) => patch({ wrap: event.target.value } as Partial<DocumentObject>)}>
                      <option value="word">{t('objectEditor.wrap.word')}</option>
                      <option value="anywhere">{t('objectEditor.wrap.anywhere')}</option>
                      <option value="none">{t('objectEditor.wrap.none')}</option>
                    </select>
                  </div>
                  <label className="check wide">
                    <input type="checkbox" checked={object.auto_shrink} onChange={(event) => patch({ auto_shrink: event.target.checked } as Partial<DocumentObject>)} />
                    {t('objectEditor.autoShrink')}
                  </label>
                </fieldset>

                <fieldset>
                  <legend>{t('objectEditor.font')}</legend>
                  <div className="form-row">
                    <label>{t('objectEditor.family')}</label>
                    <select value={object.font_family} onChange={(event) => patch({ font_family: event.target.value } as Partial<DocumentObject>)}>
                      {fontFamilies.includes(object.font_family) ? null : (
                        <option value={object.font_family}>
                          {t('objectEditor.fontFromFile', { family: object.font_family })}
                        </option>
                      )}
                      {fontFamilies.map((font) => (
                        <option key={font} value={font} style={{ fontFamily: `"${font}"` }}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <label>{t('objectEditor.fontSize')}</label>
                    <Spin value={object.font_size} step={0.5} min={1} suffix="pt" onChange={(value) => patch({ font_size: value } as Partial<DocumentObject>)} />
                  </div>
                  <div className="form-row">
                    <label>{t('objectEditor.style')}</label>
                    <span className="toggle-group">
                      <button type="button" className={object.font_weight === 'bold' ? 'icon-toggle active' : 'icon-toggle'} title={t('objectEditor.bold')} onClick={() => patch({ font_weight: object.font_weight === 'bold' ? 'normal' : 'bold' } as Partial<DocumentObject>)}>
                        <Icon name="glabels-format-text-bold" size={22} />
                      </button>
                      <button type="button" className={object.font_italic ? 'icon-toggle active' : 'icon-toggle'} title={t('objectEditor.italic')} onClick={() => patch({ font_italic: !object.font_italic } as Partial<DocumentObject>)}>
                        <Icon name="glabels-format-text-italic" size={22} />
                      </button>
                      <button type="button" className={object.font_underline ? 'icon-toggle active' : 'icon-toggle'} title={t('objectEditor.underline')} onClick={() => patch({ font_underline: !object.font_underline } as Partial<DocumentObject>)}>
                        <Icon name="glabels-format-text-underline" size={22} />
                      </button>
                    </span>
                  </div>
                  <div className="form-row">
                    <label>{t('objectEditor.color')}</label>
                    <ColorButton value={object.color.color ?? '#000000ff'} allowNone={false} onChange={(value) => patch({ color: { color: value } } as Partial<DocumentObject>)} />
                  </div>
                  {fontFamilies.includes(object.font_family) ? null : (
                    <p className="inline-warning">
                      {t('objectEditor.fontMissing', { family: object.font_family })}
                    </p>
                  )}
                </fieldset>

                <fieldset>
                  <legend>{t('objectEditor.text')}</legend>
                  <textarea
                    rows={6}
                    value={object.lines.join('\n')}
                    onChange={(event) => patch({ lines: event.target.value.split('\n') } as Partial<DocumentObject>)}
                  />
                </fieldset>
              </>
            ) : null}

            {tab === 'barcode' && object.type === 'barcode' ? (
              <>
                <fieldset>
                  <legend>{t('objectEditor.styleGroup')}</legend>
                  <div className="form-row">
                    <label>{t('objectEditor.kind')}</label>
                    <select
                      value={`${object.backend}|${object.style}`}
                      onChange={(event) => {
                        const [backend, style] = event.target.value.split('|')
                        patch({ backend, style } as Partial<DocumentObject>)
                      }}
                    >
                      {BARCODE_STYLES.some((item) => item.backend === object.backend && item.style === object.style) ? null : (
                        <option value={`${object.backend}|${object.style}`}>
                          {t('objectEditor.barcodeFromFile', {
                            style: object.style,
                            backend: object.backend || t('objectEditor.barcodeBuiltin'),
                          })}
                        </option>
                      )}
                      {BARCODE_STYLES.map((item) => (
                        <option key={`${item.backend}|${item.style}`} value={`${item.backend}|${item.style}`}>
                          {t(item.label)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="check wide">
                    <input type="checkbox" checked={object.show_text} onChange={(event) => patch({ show_text: event.target.checked } as Partial<DocumentObject>)} />
                    {t('objectEditor.showText')}
                  </label>
                  <label className="check wide">
                    <input type="checkbox" checked={object.checksum} onChange={(event) => patch({ checksum: event.target.checked } as Partial<DocumentObject>)} />
                    {t('objectEditor.checksum')}
                  </label>
                  <div className="form-row">
                    <label>{t('objectEditor.color')}</label>
                    <ColorButton value={object.color.color ?? '#000000ff'} allowNone={false} onChange={(value) => patch({ color: { color: value } } as Partial<DocumentObject>)} />
                  </div>
                </fieldset>
                <fieldset>
                  <legend>{t('objectEditor.barcodeData')}</legend>
                  <input value={object.data} onChange={(event) => patch({ data: event.target.value } as Partial<DocumentObject>)} />
                  <p className="inline-notice">{t('objectEditor.barcodeHint')}</p>
                </fieldset>
              </>
            ) : null}

            {tab === 'image' && object.type === 'image' ? (
              <fieldset>
                <legend>{t('objectEditor.file')}</legend>
                <p className="form-static">
                  {object.src ?? object.src_field ?? t('objectEditor.noSource')}
                  <br />
                  <small>{t(object.embedded ? 'objectEditor.embedded' : 'objectEditor.notEmbedded')}</small>
                </p>
              </fieldset>
            ) : null}

            {tab === 'linefill' && (object.type === 'box' || object.type === 'ellipse' || object.type === 'line') ? (
              <>
                <fieldset>
                  <legend>{t('objectEditor.line')}</legend>
                  <div className="form-row">
                    <label>{t('objectEditor.lineWidth')}</label>
                    <Spin value={object.line_width_pt} step={0.25} min={0} suffix="pt" onChange={(value) => patch({ line_width_pt: value } as Partial<DocumentObject>)} />
                  </div>
                  <div className="form-row">
                    <label>{t('objectEditor.color')}</label>
                    <ColorButton value={object.line_color.color ?? '#000000ff'} onChange={(value) => patch({ line_color: { color: value } } as Partial<DocumentObject>)} />
                  </div>
                </fieldset>
                {object.type !== 'line' ? (
                  <fieldset>
                    <legend>{t('objectEditor.fill')}</legend>
                    <div className="form-row">
                      <label>{t('objectEditor.color')}</label>
                      <ColorButton value={object.fill_color.color ?? '#00000000'} onChange={(value) => patch({ fill_color: { color: value } } as Partial<DocumentObject>)} />
                    </div>
                  </fieldset>
                ) : null}
              </>
            ) : null}

            {tab === 'geometry' ? (
              <>
                <fieldset>
                  <legend>{t('objectEditor.position')}</legend>
                  <div className="form-row">
                    <label>X:</label>
                    <Spin value={len(object.x_pt)} suffix={u} onChange={(value) => patch({ x_pt: toPt(value, unit) })} disabled={object.type === 'unsupported'} />
                  </div>
                  <div className="form-row">
                    <label>Y:</label>
                    <Spin value={len(object.y_pt)} suffix={u} onChange={(value) => patch({ y_pt: toPt(value, unit) })} disabled={object.type === 'unsupported'} />
                  </div>
                </fieldset>

                {'w_pt' in object ? (
                  <fieldset>
                    <legend>{t('objectEditor.size')}</legend>
                    <div className="form-row">
                      <label>{t('objectEditor.width')}</label>
                      <Spin value={len(object.w_pt)} min={0} suffix={u} onChange={(value) => patch({ w_pt: toPt(value, unit) } as Partial<DocumentObject>)} />
                    </div>
                    <div className="form-row">
                      <label>{t('objectEditor.height')}</label>
                      <Spin value={len(object.h_pt)} min={0} suffix={u} onChange={(value) => patch({ h_pt: toPt(value, unit) } as Partial<DocumentObject>)} />
                    </div>
                    <label className="check wide">
                      <input type="checkbox" checked={object.lock_aspect_ratio} onChange={(event) => patch({ lock_aspect_ratio: event.target.checked } as Partial<DocumentObject>)} />
                      {t('objectEditor.lockAspect')}
                    </label>
                  </fieldset>
                ) : null}

                {object.type === 'line' ? (
                  <fieldset>
                    <legend>{t('objectEditor.size')}</legend>
                    <div className="form-row">
                      <label>{t('objectEditor.lengthX')}</label>
                      <Spin value={len(object.dx_pt)} suffix={u} onChange={(value) => patch({ dx_pt: toPt(value, unit) } as Partial<DocumentObject>)} />
                    </div>
                    <div className="form-row">
                      <label>{t('objectEditor.lengthY')}</label>
                      <Spin value={len(object.dy_pt)} suffix={u} onChange={(value) => patch({ dy_pt: toPt(value, unit) } as Partial<DocumentObject>)} />
                    </div>
                  </fieldset>
                ) : null}
              </>
            ) : null}

            {tab === 'shadow' && object.type !== 'unsupported' ? (
              <fieldset>
                <legend>{t('objectEditor.shadow')}</legend>
                <label className="check wide">
                  <input type="checkbox" checked={object.shadow.enabled} onChange={(event) => patch({ shadow: { ...object.shadow, enabled: event.target.checked } } as Partial<DocumentObject>)} />
                  {t('objectEditor.shadowOn')}
                </label>
                <div className="form-row">
                  <label>{t('objectEditor.offsetX')}</label>
                  <Spin value={len(object.shadow.x_pt)} suffix={u} onChange={(value) => patch({ shadow: { ...object.shadow, x_pt: toPt(value, unit) } } as Partial<DocumentObject>)} />
                </div>
                <div className="form-row">
                  <label>{t('objectEditor.offsetY')}</label>
                  <Spin value={len(object.shadow.y_pt)} suffix={u} onChange={(value) => patch({ shadow: { ...object.shadow, y_pt: toPt(value, unit) } } as Partial<DocumentObject>)} />
                </div>
                <div className="form-row">
                  <label>{t('objectEditor.opacity')}</label>
                  <Spin value={object.shadow.opacity} step={0.05} min={0} max={1} onChange={(value) => patch({ shadow: { ...object.shadow, opacity: value } } as Partial<DocumentObject>)} />
                </div>
                <div className="form-row">
                  <label>{t('objectEditor.color')}</label>
                  <ColorButton value={object.shadow.color.color ?? '#000000ff'} allowNone={false} onChange={(value) => patch({ shadow: { ...object.shadow, color: { color: value } } } as Partial<DocumentObject>)} />
                </div>
              </fieldset>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
