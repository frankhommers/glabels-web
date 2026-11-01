/** Managing printers: adding, choosing the default and removing.
 *
 *  One list, however a printer is reached. Network printers are driverless
 *  IPP destinations, kept on the server; before adding, the printer is
 *  queried, since IPP transport alone says nothing about the formats and
 *  media it really handles. Printers attached to this device (Bluetooth)
 *  are kept in this browser and found through their driver; see
 *  `printing/devices.ts`. Both are added, chosen and removed the same way.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  printerState,
  printers as api,
  type Printer,
  type PageQuestion,
  type PrinterList,
  type PrinterTakes,
  type ProbeResult,
} from '../api/printers'
import { useDialogs } from '../ui/dialogs'
import { useT } from '../i18n'
import {
  addDevicePrinter,
  deviceDrivers,
  driverOf,
  freeName,
  removeDevicePrinter,
  setDeviceDefault,
  updateDevicePrinter,
  type DeviceDriver,
  type DevicePrinter,
} from '../printing/devices'
import { deviceProblem, withDevicePrinters } from '../printing/deviceList'

const TAKES: PrinterTakes[] = ['auto', 'continuous', 'fixed', 'any']

/** How a printer is added: over the network, or through a driver. */
type Connection = { kind: 'network' } | { kind: 'device'; driver: DeviceDriver }

export function PrintersDialog({
  page,
  onClose,
  onChanged,
}: {
  /** The label being printed: the list says which printers it fits. */
  page?: PageQuestion | null
  onClose: () => void
  onChanged: (list: PrinterList) => void
}) {
  const t = useT()
  const dialogs = useDialogs()
  // The network printers as the server reported them.
  const [list, setList] = useState<PrinterList | null>(null)
  // Bumped whenever a printer of this device changes, so the list follows.
  const [, setDeviceVersion] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [connection, setConnection] = useState<Connection>({ kind: 'network' })
  const [name, setName] = useState('')
  const [uri, setUri] = useState('ipp://')
  const [info, setInfo] = useState('')
  const [location, setLocation] = useState('')
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [found, setFound] = useState<Omit<DevicePrinter, 'id'> | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Asking every network printer for its state takes a moment.
  const [checking, setChecking] = useState(true)
  const drivers = deviceDrivers().filter((driver) => driver.supported())

  // Searching opens the browser's device picker, which must follow the click
  // closely: have the drivers ready before that.
  useEffect(() => {
    for (const driver of deviceDrivers()) if (driver.supported()) driver.prepare?.()
  }, [])

  const reload = useCallback(async () => {
    setChecking(true)
    try {
      // The printers as known right away; then with their state.
      const quick = await api.list(false, page ?? undefined)
      setList((current) => current ?? quick)
      const result = await api.list(true, page ?? undefined)
      setList(result)
      onChanged(result)
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setChecking(false)
    }
    // The page as numbers: a new object with the same size is the same page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChanged, page?.widthPt, page?.heightPt, page?.continuous])

  useEffect(() => {
    void reload()
  }, [reload])

  /** A printer of this device changed: the list and the page follow. */
  const devicesChanged = () => {
    setDeviceVersion((value) => value + 1)
    if (list) onChanged(list)
  }

  const shown = list ? withDevicePrinters(list, page ?? null).printers : []
  const takenNames = shown.map((printer) => printer.name)

  // Two drivers on the same connection are told apart by their brand.
  const connectionLabel = (driver: DeviceDriver) =>
    drivers.filter((other) => other.connection === driver.connection).length > 1
      ? `${driver.connection} (${driver.brand})`
      : driver.connection

  const resetForm = () => {
    setName('')
    setUri('ipp://')
    setInfo('')
    setLocation('')
    setProbe(null)
    setFound(null)
  }

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

  const search = async (driver: DeviceDriver) => {
    setBusy(true)
    setProblem(null)
    setFound(null)
    try {
      const result = await driver.discover()
      setFound(result)
      if (!name) setName(freeName(result.name, takenNames))
    } catch (error) {
      setProblem(deviceProblem(t, error))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    setBusy(true)
    setProblem(null)
    try {
      if (connection.kind === 'device') {
        if (!found) return
        addDevicePrinter({ ...found, name: freeName(name.trim(), list?.printers.map((printer) => printer.name) ?? []) })
        devicesChanged()
      } else {
        await api.add({ name, uri, info, location })
        await reload()
      }
      setAdding(false)
      resetForm()
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
      if (printer.device) {
        removeDevicePrinter(printer.device.id)
        devicesChanged()
      } else {
        await api.remove(printer.name)
        await reload()
      }
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const makeDefault = async (printer: Printer) => {
    setProblem(null)
    try {
      if (printer.device) {
        // The default of this device; the network keeps its own.
        setDeviceDefault(printer.device.id)
        devicesChanged()
      } else {
        setDeviceDefault(null)
        await api.setDefault(printer.name)
        await reload()
      }
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }

  const changeTakes = async (printer: Printer, takes: PrinterTakes) => {
    setProblem(null)
    try {
      if (printer.device) {
        updateDevicePrinter(printer.device.id, { takes })
        devicesChanged()
      } else {
        await api.setTakes(printer.name, takes)
        await reload()
      }
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }

  const networkUnavailable = list ? !list.available : true
  const canAdd = !networkUnavailable || drivers.length > 0

  return (
    <div className="modal-backdrop" role="dialog" aria-modal aria-label={t('printers.title')}>
      <div className="modal printers-dialog">
        <div className="modal-title">{t('printers.title')}</div>
        <div className="modal-body">
          {list && !list.available ? (
            <p className="inline-warning">{list.message ?? t('printers.unavailable')}</p>
          ) : null}

          <table className="project-table printers-table">
            <thead>
              <tr>
                <th>{t('printers.name')}</th>
                <th>{t('printers.connection')}</th>
                <th>{t('printers.status')}</th>
                <th title={t('printers.takesHint')}>{t('printers.takes')}</th>
                <th>{t('printers.default')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list && shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="placeholder">
                    {t('printers.none')}
                  </td>
                </tr>
              ) : (
                shown.map((printer) => (
                  <tr
                    key={printer.device ? `device-${printer.device.id}` : printer.name}
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
                    <td className="merge-source">
                      {printer.device ? (
                        <>
                          {driverOf(printer.device)?.connection ?? printer.device.driver}
                          <br />
                          <small className="muted">{t('printers.thisDevice')}</small>
                        </>
                      ) : (
                        <>
                          {t('printers.network')}
                          <br />
                          <small className="muted">{printer.uri}</small>
                        </>
                      )}
                    </td>
                    <td>
                      {printer.device ? (
                        <span className="muted">{t('printers.state.onDemand')}</span>
                      ) : checking && !printer.reachable ? (
                        <span className="spinner" role="status" aria-label={t('print.checkingPrinters')} />
                      ) : (
                        <>
                          {printerState(t, printer)}
                          {printer.reachable && !printer.accepting ? ` · ${t('print.notAccepting')}` : ''}
                          {printer.state_message ? (
                            <>
                              <br />
                              <small className="muted">{printer.state_message}</small>
                            </>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td>
                      <select
                        value={printer.takes}
                        disabled={busy}
                        title={t('printers.takesHint')}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => void changeTakes(printer, event.target.value as PrinterTakes)}
                      >
                        {TAKES.map((takes) => (
                          <option key={takes} value={takes}>
                            {t(`printers.takes.${takes}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {printer.is_default ? (
                        t('printers.yes')
                      ) : (
                        <button
                          type="button"
                          className="linklike"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation()
                            void makeDefault(printer)
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
                <label>{t('printers.connection')}</label>
                <span className="choice-row">
                  {networkUnavailable ? null : (
                    <label className="check">
                      <input
                        type="radio"
                        name="connection"
                        checked={connection.kind === 'network'}
                        onChange={() => {
                          setConnection({ kind: 'network' })
                          resetForm()
                        }}
                      />
                      {t('printers.network')}
                    </label>
                  )}
                  {drivers.map((driver) => (
                    <label key={driver.id} className="check">
                      <input
                        type="radio"
                        name="connection"
                        checked={connection.kind === 'device' && connection.driver.id === driver.id}
                        onChange={() => {
                          setConnection({ kind: 'device', driver })
                          resetForm()
                        }}
                      />
                      {connectionLabel(driver)}
                    </label>
                  ))}
                </span>
              </div>

              {connection.kind === 'network' ? (
                <>
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
                          {probe.media.length > 6 ? t('printers.mediaMore', { count: probe.media.length - 6 }) : ''}
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
                </>
              ) : (
                <>
                  <p className="muted">{t('printers.searchHint')}</p>
                  <div className="form-row">
                    <label />
                    <button type="button" disabled={busy} onClick={() => void search(connection.driver)}>
                      {t('printers.search')}
                    </button>
                  </div>
                  {found ? (
                    <div className="probe-result">
                      <p>
                        <strong>
                          {connection.driver.brand} {found.model}
                        </strong>
                      </p>
                      <p className="muted">{t('printers.thisDeviceHint')}</p>
                    </div>
                  ) : null}
                </>
              )}

              <div className="form-row">
                <label>{t('printers.nameField')}</label>
                <input value={name} placeholder="Labelprinter" onChange={(event) => setName(event.target.value)} />
              </div>
              {connection.kind === 'network' ? (
                <>
                  <div className="form-row">
                    <label>{t('printers.description')}</label>
                    <input value={info} onChange={(event) => setInfo(event.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>{t('printers.location')}</label>
                    <input value={location} onChange={(event) => setLocation(event.target.value)} />
                  </div>
                </>
              ) : null}
              <div className="form-row">
                <label />
                <span className="button-row">
                  <button
                    type="button"
                    className="default"
                    disabled={
                      busy ||
                      !name.trim() ||
                      (connection.kind === 'network' ? !probe?.reachable || !probe?.accepts_pdf : !found)
                    }
                    onClick={() => void add()}
                  >
                    {t('common.add')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAdding(false)
                      resetForm()
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </span>
              </div>
              {connection.kind === 'network' ? (
                !probe?.reachable ? (
                  <p className="muted">{t('printers.testFirst')}</p>
                ) : !probe.accepts_pdf ? (
                  <p className="muted">{t('printers.noPdf')}</p>
                ) : null
              ) : !found ? (
                <p className="muted">{t('printers.searchFirst')}</p>
              ) : null}
            </fieldset>
          ) : null}

          {problem ? <p className="inline-warning">{problem}</p> : null}
        </div>

        <div className="modal-buttons">
          <button
            type="button"
            disabled={adding || busy || !canAdd}
            onClick={() => {
              setConnection(networkUnavailable && drivers[0] ? { kind: 'device', driver: drivers[0] } : { kind: 'network' })
              resetForm()
              setAdding(true)
            }}
          >
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
