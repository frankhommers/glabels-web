/** Managing printers: adding, choosing the default and removing.
 *
 *  Only driverless IPP destinations. Before adding, the printer is queried
 *  first: IPP transport alone says nothing about the formats and media it
 *  really handles.
 */

import { useCallback, useEffect, useState } from 'react'
import { printerState, printers as api, type Printer, type PrinterList, type ProbeResult } from '../api/printers'
import { useDialogs } from '../ui/dialogs'
import { useT } from '../i18n'

export function PrintersDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void
  onChanged: (list: PrinterList) => void
}) {
  const t = useT()
  const dialogs = useDialogs()
  const [list, setList] = useState<PrinterList | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [uri, setUri] = useState('ipp://')
  const [info, setInfo] = useState('')
  const [location, setLocation] = useState('')
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const result = await api.list()
      setList(result)
      onChanged(result)
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }, [onChanged])

  useEffect(() => {
    void reload()
  }, [reload])

  const testConnection = async () => {
    setBusy(true)
    setProblem(null)
    setProbe(null)
    try {
      const result = await api.probe(uri)
      setProbe(result)
      if (result.reachable && !name) {
        // Suggest a usable name based on what the printer reports.
        const suggestion = (result.make_and_model || 'printer').replace(/[^A-Za-z0-9_.-]+/g, '-')
        setName(suggestion.slice(0, 40).replace(/^-+|-+$/g, ''))
      }
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await api.add({ name, uri, info, location })
      setAdding(false)
      setName('')
      setUri('ipp://')
      setInfo('')
      setLocation('')
      setProbe(null)
      await reload()
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (printer: Printer) => {
    const confirmed = await dialogs.confirm({
      title: t('printers.deleteTitle'),
      message: (
        <>
          <strong>{printer.name}</strong>
          <br />
          {t('printers.deleteQuestion')}
        </>
      ),
      confirmLabel: t('common.delete'),
      destructive: true,
    })
    if (!confirmed) return
    setBusy(true)
    setProblem(null)
    try {
      await api.remove(printer.name)
      await reload()
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-label={t('printers.title')}>
      <div className="modal printers-dialog">
        <div className="modal-title">{t('printers.title')}</div>
        <div className="modal-body">
          {list && !list.available ? (
            <p className="inline-warning">
              {list.message ?? t('printers.unavailable')}
            </p>
          ) : null}

          <table className="project-table">
            <thead>
              <tr>
                <th>{t('printers.name')}</th>
                <th>{t('printers.destination')}</th>
                <th>{t('printers.status')}</th>
                <th>{t('printers.default')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list?.printers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="placeholder">
                    {t('printers.none')}
                  </td>
                </tr>
              ) : (
                list?.printers.map((printer) => (
                  <tr
                    key={printer.name}
                    className={selected === printer.name ? 'selected' : undefined}
                    onClick={() => setSelected(printer.name)}
                  >
                    <td>
                      {printer.name}
                      {printer.info && printer.info !== printer.name ? (
                        <>
                          <br />
                          <small className="muted">{printer.info}</small>
                        </>
                      ) : null}
                    </td>
                    <td className="merge-source">{printer.uri}</td>
                    <td>
                      {printerState(t, printer)}
                      {printer.reachable && !printer.accepting ? ' · neemt niets aan' : ''}
                      {printer.state_message ? (
                        <>
                          <br />
                          <small className="muted">{printer.state_message}</small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {printer.is_default ? (
                        t('printers.yes')
                      ) : (
                        <button
                          type="button"
                          className="linklike"
                          disabled={busy}
                          onClick={async (event) => {
                            event.stopPropagation()
                            await api.setDefault(printer.name)
                            await reload()
                          }}
                        >
                          {t('printers.makeDefault')}
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="linklike"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation()
                          void remove(printer)
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {adding ? (
            <fieldset className="printer-form">
              <legend>{t('printers.addHeading')}</legend>
              <div className="form-row">
                <label>{t('printers.address')}</label>
                <input
                  value={uri}
                  placeholder="ipp://192.168.1.50/ipp/print"
                  onChange={(event) => setUri(event.target.value)}
                />
              </div>
              <p className="muted">{t('printers.addressHint')}</p>
              <div className="form-row">
                <label />
                <button type="button" disabled={busy || uri.length < 8} onClick={() => void testConnection()}>
                  {t('printers.testConnection')}
                </button>
              </div>

              {probe ? (
                probe.reachable ? (
                  <div className="probe-result">
                    <p>
                      <strong>{probe.make_and_model || t('printers.found')}</strong> — {printerState(t, probe)}
                    </p>
                    <p className="muted">
                      {t('printers.formats', {
                        formats: probe.document_formats.join(', ') || t('common.unknown'),
                      })}
                      <br />
                      {t('printers.media', {
                        media: probe.media.slice(0, 6).join(', ') || t('common.unknown'),
                      })}
                      {probe.media.length > 6
                        ? t('printers.mediaMore', { count: probe.media.length - 6 })
                        : ''}
                      {probe.media_ready.length ? (
                        <>
                          <br />
                          {t('printers.mediaLoaded', { media: probe.media_ready.join(', ') })}
                        </>
                      ) : null}
                    </p>
                    {probe.problems.map((item) => (
                      <p key={item} className="inline-notice">
                        {item}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="inline-warning">
                    {t('printers.unreachable', {
                      reason: probe.problems.join('; ') || t('printers.unknownCause'),
                    })}
                  </p>
                )
              ) : null}

              <div className="form-row">
                <label>{t('printers.nameField')}</label>
                <input
                  value={name}
                  placeholder="Labelprinter"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="form-row">
                <label>{t('printers.description')}</label>
                <input value={info} onChange={(event) => setInfo(event.target.value)} />
              </div>
              <div className="form-row">
                <label>{t('printers.location')}</label>
                <input value={location} onChange={(event) => setLocation(event.target.value)} />
              </div>
              <div className="form-row">
                <label />
                <span className="button-row">
                  <button
                    type="button"
                    className="default"
                    disabled={busy || !name || !probe?.reachable || !probe?.accepts_pdf}
                    onClick={() => void add()}
                  >
                    {t('common.add')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setAdding(false)}>
                    {t('common.cancel')}
                  </button>
                </span>
              </div>
              {!probe?.reachable ? (
                <p className="muted">{t('printers.testFirst')}</p>
              ) : !probe.accepts_pdf ? (
                <p className="muted">{t('printers.noPdf')}</p>
              ) : null}
            </fieldset>
          ) : null}

          {problem ? <p className="inline-warning">{problem}</p> : null}
        </div>

        <div className="modal-buttons">
          <button type="button" disabled={adding || busy || (list ? !list.available : true)} onClick={() => setAdding(true)}>
            {t('printers.addButton')}
          </button>
          <span className="spacer" />
          <button type="button" className="default" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
