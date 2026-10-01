/** Merge: choose the source type and file, and check the data.
 *
 *  The document refers to the source relative to its own folder, as the
 *  desktop app does. A source with field names on line 1 is also the label's
 *  list: rows can be added and edited here or on a phone, and printed when
 *  you like (see ListTable).
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { MergePreview } from '../api/types'
import type { Session } from '../app/session'
import type { MessageKey } from '../i18n'
import { FileDialog } from '../components/FileDialog'
import { ListTable } from '../components/ListTable'
import { lists, type LabelList } from '../api/lists'

const MERGE_TYPES: { id: string; label: MessageKey }[] = [
  { id: 'None', label: 'merge.type.none' },
  { id: 'Text/Comma/Line1Keys', label: 'merge.type.commaKeys' },
  { id: 'Text/Comma', label: 'merge.type.comma' },
  { id: 'Text/Tab/Line1Keys', label: 'merge.type.tabKeys' },
  { id: 'Text/Tab', label: 'merge.type.tab' },
  { id: 'Text/Semicolon/Keys', label: 'merge.type.semicolonKeys' },
  { id: 'Text/Semicolon', label: 'merge.type.semicolon' },
  { id: 'Text/Colon/Line1Keys', label: 'merge.type.colonKeys' },
  { id: 'Text/Colon', label: 'merge.type.colon' },
]

export function MergePage({ session }: { session: Session }) {
  const t = session.t
  const detail = session.detail
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [list, setList] = useState<LabelList | null>(null)

  const mergeType = detail?.merge?.type ?? 'None'
  const sourcePath = detail?.merge?.source_path ?? null

  const reload = useCallback(async () => {
    if (!detail) return
    try {
      setPreview(await api.mergePreview(detail.id))
      setList(await lists.get(detail.id).catch(() => null))
      setProblem(null)
    } catch (error) {
      setPreview(null)
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }, [detail])

  const listChanged = async (next: LabelList) => {
    setList(next)
    // The first row made the list's file and linked it: show that.
    if (detail && next.source_path && next.source_path !== detail.merge?.source_path) {
      session.setDetail(await api.getDocument(detail.id))
    }
  }

  useEffect(() => {
    void reload()
  }, [reload])

  if (!detail) return null

  const apply = async (type: string, path: string | null) => {
    setBusy(true)
    setProblem(null)
    try {
      const updated = await api.setMerge(detail.id, type, path)
      session.setDetail(updated)
      session.history.reset(updated.content.objects)
      if (type === 'None') session.setStatus('merge.disabled')
      else session.setStatus('merge.set', { number: updated.revision })
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-form merge-page">
      <fieldset>
        <legend>{t('merge.source')}</legend>
        <div className="form-row">
          <label>{t('merge.type')}</label>
          <select
            value={mergeType}
            disabled={busy}
            onChange={(event) => void apply(event.target.value, event.target.value === 'None' ? null : sourcePath)}
          >
            {MERGE_TYPES.some((item) => item.id === mergeType) ? null : (
              <option value={mergeType}>{t('merge.typeFromFile', { type: mergeType })}</option>
            )}
            {MERGE_TYPES.map((item) => (
              <option key={item.id} value={item.id}>
                {t(item.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>{t('merge.file')}</label>
          <span className="form-static merge-source">
            {sourcePath ?? detail.merge?.src ?? t('merge.noSource')}
          </span>
        </div>
        <div className="form-row">
          <label />
          <span className="button-row">
            <button type="button" disabled={busy || mergeType === 'None'} onClick={() => setPicking(true)}>
              {t('merge.chooseFile')}
            </button>
            <button
              type="button"
              disabled={busy || !sourcePath}
              onClick={() => void apply(mergeType, null)}
            >
              {t('merge.unlink')}
            </button>
          </span>
        </div>
        {mergeType === 'None' ? (
          <p className="inline-notice">
            {t('merge.chooseTypeFirst')}
          </p>
        ) : null}
        {problem ? <p className="inline-warning">{problem}</p> : null}
      </fieldset>

      {list?.available && list.fields.length > 0 ? (
        <fieldset>
          <legend>{t('merge.list')}</legend>
          <p className="muted">
            {list.source_path ? t('merge.listHint') : t('merge.listNew', { fields: list.fields.join(', ') })}
          </p>
          <ListTable docId={detail.id} list={list} onChange={(next) => void listChanged(next)} onProblem={setProblem} />
        </fieldset>
      ) : null}

      {list?.available && list.fields.length > 0 ? (
        <fieldset>
          <legend>{t('merge.fieldLines')}</legend>
          <p className="muted">{t('merge.fieldLinesHint')}</p>
          <div className="field-lines">
            {list.fields.map((field) => {
              const auto = list.lines_auto[field] === 'multi' ? t('list.moreLines') : t('list.oneLine')
              return (
                <div key={field} className="form-row">
                  <label htmlFor={`lines-${field}`}>
                    <code>{'${' + field + '}'}</code>
                  </label>
                  <select
                    id={`lines-${field}`}
                    value={list.lines_chosen[field] ?? 'auto'}
                    onChange={async (event) => {
                      try {
                        const value = event.target.value as 'auto' | 'multi' | 'single'
                        await listChanged(await lists.setLines(detail.id, field, value))
                      } catch (error) {
                        setProblem(String(error instanceof Error ? error.message : error))
                      }
                    }}
                  >
                    <option value="auto">{t('merge.linesAuto', { mode: auto })}</option>
                    <option value="single">{t('list.oneLine')}</option>
                    <option value="multi">{t('list.moreLines')}</option>
                  </select>
                </div>
              )
            })}
          </div>
        </fieldset>
      ) : null}

      {preview && preview.keys.length > 0 && !(list?.available && list.fields.length > 0) ? (
        <>
          <fieldset>
            <legend>{t('merge.fields')}</legend>
            <p className="muted">{t('merge.fieldsHint')}</p>
            <ul className="field-chips">
              {preview.keys.map((key) => (
                <li key={key}>
                  <code>{'${' + key + '}'}</code>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend>{t('merge.data', { count: preview.record_count })}</legend>
            <div className="merge-table-wrap">
              <table className="project-table">
                <thead>
                  <tr>
                    {preview.keys.map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.records.map((record, index) => (
                    <tr key={index}>
                      {preview.keys.map((key) => (
                        <td key={key}>{record[key] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.truncated ? (
              <p className="muted">{t('merge.truncated', { count: preview.records.length })}</p>
            ) : null}
            <p className="inline-notice">{t('merge.previewHint')}</p>
          </fieldset>
        </>
      ) : null}

      {picking ? (
        <FileDialog
          title={t('merge.chooseTitle')}
          mode="select"
          accept={['data']}
          confirmLabel={t('merge.choose')}
          onCancel={() => setPicking(false)}
          onChoose={async (result) => {
            setPicking(false)
            if (result.kind === 'file') await apply(mergeType, result.path)
          }}
        />
      ) : null}
    </div>
  )
}
