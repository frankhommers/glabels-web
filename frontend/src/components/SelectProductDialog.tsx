/** "Select product" dialog, laid out like the desktop app: search by
 *  brand/part/description, with a thumbnail of the sheet layout. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Template } from '../api/types'
import { formatLength, type UnitId } from '../editor/units'
import { useT } from '../i18n'
import { useDialogs } from '../ui/dialogs'
import { TemplateEditorDialog } from './TemplateEditorDialog'

export function SheetPreview({ template }: { template: Template }) {
  const t = useT()
  const frame = template.frames[0]
  const layout = frame?.layouts[0]
  const pageWidth = template.page_width_pt ?? 0
  const pageHeight = template.page_height_pt ?? 0
  if (!frame || !layout || pageWidth <= 0 || pageHeight <= 0) {
    return <p className="placeholder">{t('product.noSheetLayout')}</p>
  }

  const width = frame.width_pt ?? (frame.radius_pt ?? 0) * 2
  const height = frame.height_pt ?? (frame.radius_pt ?? 0) * 2
  const cells = []
  for (let iy = 0; iy < layout.ny; iy += 1) {
    for (let ix = 0; ix < layout.nx; ix += 1) {
      cells.push({ key: `${ix}-${iy}`, x: layout.x0_pt + ix * layout.dx_pt, y: layout.y0_pt + iy * layout.dy_pt })
    }
  }

  return (
    <svg className="sheet-preview" viewBox={`0 0 ${pageWidth} ${pageHeight}`} role="img" aria-label={t('product.sheetLayout')}>
      <rect x={0} y={0} width={pageWidth} height={pageHeight} fill="#ffffff" stroke="#767676" strokeWidth={1} />
      {cells.map((cell) =>
        frame.shape === 'round' || frame.shape === 'cd' ? (
          <circle key={cell.key} cx={cell.x + width / 2} cy={cell.y + height / 2} r={frame.radius_pt ?? width / 2} fill="#dce9f6" stroke="#2a6099" strokeWidth={0.8} />
        ) : frame.shape === 'ellipse' ? (
          <ellipse key={cell.key} cx={cell.x + width / 2} cy={cell.y + height / 2} rx={width / 2} ry={height / 2} fill="#dce9f6" stroke="#2a6099" strokeWidth={0.8} />
        ) : (
          <rect key={cell.key} x={cell.x} y={cell.y} width={width} height={height} rx={frame.round_pt ?? 0} fill="#dce9f6" stroke="#2a6099" strokeWidth={0.8} />
        ),
      )}
    </svg>
  )
}

export function SelectProductDialog({
  title,
  unit,
  onChoose,
  onCancel,
}: {
  title?: string
  unit: UnitId
  onChoose: (template: Template) => void
  onCancel: () => void
}) {
  const t = useT()
  const dialogs = useDialogs()
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [brands, setBrands] = useState<string[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [items, setItems] = useState<Template[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Template | null>(null)
  const [editing, setEditing] = useState<{ base: Template | null } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    api.brands().then(setBrands).catch(() => setBrands([]))
    fetch('/api/templates/categories')
      .then((response) => response.json())
      .then(setCategories)
      .catch(() => setCategories([]))
  }, [dialogs, t])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .searchTemplates({ q: query, brand: brand || undefined, category: category || undefined, limit: 200 })
        .then((result) => {
          if (cancelled) return
          setItems(result.items)
          setTotal(result.total)
        })
        .catch(() => undefined)
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, brand, category, reloadCount])

  const remove = useCallback(async (template: Template) => {
    const confirmed = await dialogs.confirm({
      title: t('product.deleteTitle'),
      message: (
        <>
          <strong>
            {template.brand} {template.part}
          </strong>
          <br />
          {t('product.deleteQuestion')}
        </>
      ),
      confirmLabel: t('common.delete'),
      destructive: true,
    })
    if (!confirmed) return
    try {
      await api.deleteTemplate(template.brand, template.part)
      setSelected(null)
      setReloadCount((value) => value + 1)
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }, [dialogs, t])

  const layout = useMemo(() => selected?.frames[0]?.layouts[0], [selected])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-label={title ?? t('product.title')}>
      <div className="modal">
        <div className="modal-title">{title ?? t('product.title')}</div>
        <div className="modal-body product-dialog">
          <div className="product-filters">
            <label>
              {t('product.search')}
              <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder={t('product.searchPlaceholder')} />
            </label>
            <label>
              {t('product.brand')}
              <select value={brand} onChange={(event) => setBrand(event.target.value)}>
                <option value="">{t('product.all')}</option>
                {brands.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('product.category')}
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">{t('product.all')}</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="count">{t('product.count', { count: total })}</span>
          </div>

          <div className="product-body">
            <ul className="product-list">
              {items.map((template) => {
                const frame = template.frames[0]
                const width = frame?.width_pt ?? (frame?.radius_pt ?? 0) * 2
                const height = frame?.height_pt ?? (frame?.radius_pt ?? 0) * 2
                const active = selected?.brand === template.brand && selected?.part === template.part
                return (
                  <li key={`${template.brand}-${template.part}`}>
                    <button
                      type="button"
                      className={active ? 'product active' : 'product'}
                      onClick={() => setSelected(template)}
                      onDoubleClick={() => onChoose(template)}
                    >
                      <span className="product-name">
                        {template.brand} {template.part}
                      </span>
                      <span className="product-meta">{template.description}</span>
                      <span className="product-meta">
                        {formatLength(width, unit)} × {formatLength(height, unit)} {t(`unit.${unit}`)}
                        {template.size ? ` · ${template.size}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="product-detail">
              {selected ? (
                <>
                  <h3>
                    {selected.brand} {selected.part}
                  </h3>
                  <p className="muted">{selected.description}</p>
                  <SheetPreview template={selected} />
                  {layout ? (
                    <p className="muted">
                      {t('product.perSheet', { nx: layout.nx, ny: layout.ny })}
                    </p>
                  ) : null}
                  {selected.equiv_part ? (
                    <p className="muted">{t('product.equivalentTo', { part: selected.equiv_part })}</p>
                  ) : null}
                  {selected.source === 'user' ? (
                    <p className="muted">{t('product.userDefinition')}</p>
                  ) : null}
                </>
              ) : (
                <p className="placeholder">{t('product.pickLeft')}</p>
              )}
            </div>
          </div>
        </div>
        {problem ? <p className="inline-warning">{problem}</p> : null}

        <div className="modal-buttons">
          <button type="button" onClick={() => setEditing({ base: selected })}>
            {t(selected ? 'product.newFrom' : 'product.new')}
          </button>
          <button
            type="button"
            disabled={selected?.source !== 'user'}
            title={
              selected && selected.source !== 'user'
                ? t('product.builtinReadOnly')
                : undefined
            }
            onClick={() => selected && setEditing({ base: selected })}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            disabled={selected?.source !== 'user'}
            onClick={() => selected && void remove(selected)}
          >
            {t('common.delete')}
          </button>
          <span className="spacer" />
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="default" disabled={!selected} onClick={() => selected && onChoose(selected)}>
            {t('common.ok')}
          </button>
        </div>
      </div>

      {editing ? (
        <TemplateEditorDialog
          base={editing.base}
          unit={unit}
          onCancel={() => setEditing(null)}
          onSaved={(template) => {
            setEditing(null)
            setSelected(template)
            setQuery(`${template.brand} ${template.part}`)
            setBrand('')
            setCategory('')
            setReloadCount((value) => value + 1)
          }}
        />
      ) : null}
    </div>
  )
}
