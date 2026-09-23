/** Print page, laid out like PrintView in the desktop app: destination,
 *  range, counts, options and a page preview.
 *
 *  The preview is a rasterisation of exactly the PDF that goes to the
 *  printer. So "what you see" is literally "what gets printed"; there is no
 *  second rendering that could differ from it.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { newRequestId, printerState, printers as printerApi, type PrintJob, type PrinterList } from '../api/printers'
import type { MessageKey, Translate } from '../i18n'
import { useDialogs } from '../ui/dialogs'
import type { PreviewInfo, PrintSettings, Template } from '../api/types'
import type { Session } from '../app/session'
import { PrintersDialog } from '../components/PrintersDialog'

/** How many labels fit on one page (all layouts together). */
function labelsPerPage(template: Template | null): number | null {
  const layouts = template?.frames[0]?.layouts
  if (!layouts?.length) return null
  return layouts.reduce((total, layout) => total + layout.nx * layout.ny, 0)
}

// Jobs per step in the list, and how often we ask while something is running.
const JOB_PAGE = 10
const JOB_POLL_MS = 2000

/** The state of a job in the user's language. */
function jobStatus(t: Translate, job: PrintJob): string {
  const keys: Record<number, MessageKey> = {
    3: 'print.state.pending',
    4: 'print.state.held',
    5: 'print.state.processing',
    6: 'print.state.stopped',
    7: 'print.state.canceled',
    8: 'print.state.aborted',
    9: 'print.state.completed',
  }
  const key = keys[job.state_code]
  return key ? t(key) : t('common.unknown')
}

export function PrintPage({ session, template }: { session: Session; template: Template | null }) {
  const t = session.t
  const dialogs = useDialogs()
  const { detail, printSettings } = session
  // One label per page (like a Dymo roll): then full sheets and positions
  // are the same thing, and only a count is left to choose. Upstream always
  // shows the choice; here it would only confuse.
  const onePerPage = labelsPerPage(template) === 1
  const [info, setInfo] = useState<PreviewInfo | null>(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [mode, setMode] = useState<'sheets' | 'positions'>(printSettings.sheets ? 'sheets' : 'positions')
  const [printerList, setPrinterList] = useState<PrinterList | null>(null)
  const [printer, setPrinter] = useState<string>('')
  const [managing, setManaging] = useState(false)
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [printing, setPrinting] = useState(false)
  const [printMessage, setPrintMessage] = useState<string | null>(null)

  const loadPrinters = useCallback(async () => {
    try {
      const result = await printerApi.list()
      setPrinterList(result)
      setPrinter((current) => {
        if (current && result.printers.some((item) => item.name === current)) return current
        return result.printers.find((item) => item.is_default)?.name ?? result.printers[0]?.name ?? ''
      })
    } catch {
      setPrinterList(null)
    }
  }, [])

  // How many jobs are shown; "Show more" raises this.
  const [jobLimit, setJobLimit] = useState(JOB_PAGE)
  const [jobTotal, setJobTotal] = useState(0)

  const loadJobs = useCallback(async () => {
    try {
      const result = await printerApi.jobs(jobLimit)
      setJobs(result.items)
      setJobTotal(result.total)
    } catch {
      setJobs([])
      setJobTotal(0)
    }
  }, [jobLimit])

  // While a job is pending or processing we ask for its state every couple
  // of seconds; once everything is done, we stop. A hidden tab does not ask
  // either: nobody is looking.
  const running = jobs.some((job) => job.active)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadJobs()
    }, JOB_POLL_MS)
    return () => window.clearInterval(timer)
  }, [running, loadJobs])

  const clearJobs = async () => {
    const confirmed = await dialogs.confirm({
      title: t('print.cleanUpTitle'),
      message: t('print.cleanUpQuestion'),
      confirmLabel: t('print.cleanUp'),
      destructive: true,
    })
    if (!confirmed) return
    try {
      await printerApi.clearJobs()
      setJobLimit(JOB_PAGE)
      await loadJobs()
    } catch (error) {
      setProblem(String(error instanceof Error ? error.message : error))
    }
  }

  useEffect(() => {
    void loadPrinters()
  }, [loadPrinters])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  const update = (patch: Partial<PrintSettings>) => {
    session.setPrintSettings({ ...printSettings, ...patch })
  }

  const reload = useCallback(async () => {
    if (!detail) return
    setBusy(true)
    setProblem(null)
    try {
      // What is on screen must be saved before the renderer starts;
      // otherwise the preview would show an older version.
      await session.flush()
      const result = await api.previewInfo(detail.id, printSettings)
      setInfo(result)
      setPage((current) => Math.min(current, result.pages))
    } catch (error) {
      setInfo(null)
      setProblem(String(error))
    } finally {
      setBusy(false)
    }
  }, [detail, printSettings, session])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!detail) return null

  const landscape = info ? info.page_width_pt > info.page_height_pt : false
  const selectedPrinter = printerList?.printers.find((item) => item.name === printer) ?? null

  const submitPrint = async () => {
    if (!printer) return
    setPrinting(true)
    setPrintMessage(null)
    try {
      // Always print the version the user is looking at.
      await session.flush()
      const result = await printerApi.print(detail.id, printer, printSettings, newRequestId())
      setPrintMessage(
        result.duplicate
          ? t('print.alreadySent', { job: result.job_id })
          : t('print.sent', { printer: result.printer, job: result.job_id }),
      )
      await loadJobs()
    } catch (error) {
      setPrintMessage(null)
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setPrinting(false)
    }
  }
  const merging = Boolean(detail.merge && detail.merge.type !== 'None' && detail.merge.available)

  return (
    <div className="print-page">
      <div className="print-settings">
        <fieldset>
          <legend>{t('print.destination')}</legend>
          <div className="form-row">
            <label>{t('print.printer')}</label>
            <select
              value={printer}
              disabled={!printerList?.available || printerList.printers.length === 0}
              onChange={(event) => setPrinter(event.target.value)}
            >
              {printerList?.printers.length ? (
                printerList.printers.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.is_default ? t('print.default', { name: item.name }) : item.name}
                  </option>
                ))
              ) : (
                <option value="">{t('print.noPrinter')}</option>
              )}
            </select>
          </div>
          {selectedPrinter ? (
            <p className="form-static printer-status">
              {printerState(t, selectedPrinter)}
              {selectedPrinter.reachable && !selectedPrinter.accepting
                ? ` · ${t('print.notAccepting')}`
                : ''}
              {selectedPrinter.make_and_model ? ` · ${selectedPrinter.make_and_model}` : ''}
            </p>
          ) : null}
          <div className="form-row">
            <label />
            <span className="button-row">
              <button type="button" onClick={() => setManaging(true)}>
                {t('print.managePrinters')}
              </button>
            </span>
          </div>
          {printerList && !printerList.available ? (
            <p className="inline-warning">
              {printerList.message ?? t('print.unavailable')} {t('print.unavailablePdf')}
            </p>
          ) : null}
        </fieldset>

        {merging ? (
          <fieldset>
            <legend>{t('print.merge')}</legend>
            <p className="form-static">
              {t('print.source', { source: detail.merge?.source_path ?? detail.merge?.src ?? '' })}
            </p>
            <div className="form-row">
              <label>{t('print.copies')}</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={printSettings.copies ?? 1}
                onChange={(event) => update({ copies: Math.max(1, Number(event.target.value)), sheets: null })}
              />
            </div>
            <label className="check wide">
              <input
                type="radio"
                name="collate"
                checked={!printSettings.collate}
                onChange={() => update({ collate: false })}
              />
              {t('print.uncollated')}
            </label>
            <label className="check wide">
              <input
                type="radio"
                name="collate"
                checked={printSettings.collate}
                onChange={() => update({ collate: true })}
              />
              {t('print.collated')}
            </label>
            <label className="check wide">
              <input
                type="checkbox"
                checked={printSettings.group_per_page}
                onChange={(event) => update({ group_per_page: event.target.checked })}
              />
              {t('print.groupPerPage')}
            </label>
            <div className="form-row">
              <label>{t('print.startPosition')}</label>
              <input
                type="number"
                min={1}
                value={printSettings.first}
                onChange={(event) => update({ first: Math.max(1, Number(event.target.value)) })}
              />
            </div>
          </fieldset>
        ) : null}

        <fieldset disabled={merging}>
          <legend>{t('print.range')}</legend>
          {merging ? (
            <p className="inline-notice">
              {t('print.mergeDecides')}
            </p>
          ) : null}
          {onePerPage ? (
            <div className="form-row">
              <label>{t('print.labelCount')}</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={printSettings.copies ?? printSettings.sheets ?? 1}
                onChange={(event) =>
                  update({ copies: Math.max(1, Number(event.target.value)), sheets: null, first: 1 })
                }
              />
            </div>
          ) : (
            <>
              <label className="check wide">
                <input
                  type="radio"
                  name="range"
                  checked={mode === 'sheets'}
                  onChange={() => {
                    setMode('sheets')
                    update({ sheets: printSettings.sheets ?? 1, copies: null })
                  }}
                />
                {t('print.fullSheets')}
              </label>
              {mode === 'sheets' ? (
                <div className="form-row indented">
                  <label>{t('print.sheetCount')}</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={printSettings.sheets ?? 1}
                    onChange={(event) => update({ sheets: Math.max(1, Number(event.target.value)), copies: null })}
                  />
                </div>
              ) : null}

              <label className="check wide">
                <input
                  type="radio"
                  name="range"
                  checked={mode === 'positions'}
                  onChange={() => {
                    setMode('positions')
                    update({ copies: printSettings.copies ?? 1, sheets: null })
                  }}
                />
                {t('print.positions')}
              </label>
              {mode === 'positions' ? (
                <>
                  <div className="form-row indented">
                    <label>{t('print.startPosition')}</label>
                    <input
                      type="number"
                      min={1}
                      value={printSettings.first}
                      onChange={(event) => update({ first: Math.max(1, Number(event.target.value)) })}
                    />
                  </div>
                  <div className="form-row indented">
                    <label>{t('print.labelCount')}</label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={printSettings.copies ?? 1}
                      onChange={(event) => update({ copies: Math.max(1, Number(event.target.value)), sheets: null })}
                    />
                  </div>
                </>
              ) : null}
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>{t('print.options')}</legend>
          <label className="check wide">
            <input type="checkbox" checked={printSettings.outlines} onChange={(event) => update({ outlines: event.target.checked })} />
            {t('print.outlines')}
          </label>
          <label className="check wide">
            <input type="checkbox" checked={printSettings.crop_marks} onChange={(event) => update({ crop_marks: event.target.checked })} />
            {t('print.cropMarks')}
          </label>
          <label className="check wide">
            <input type="checkbox" checked={printSettings.reverse} onChange={(event) => update({ reverse: event.target.checked })} />
            {t('print.mirror')}
          </label>
        </fieldset>

        <div className="print-actions">
          <button
            type="button"
            className="default"
            disabled={printing || !printer || !printerList?.available}
            onClick={() => void submitPrint()}
          >
            {t(printing ? 'common.busy' : 'print.print')}
          </button>
          <a className="button" href={api.printPdfUrl(detail.id, printSettings)} download>
            {t('print.saveAsPdf')}
          </a>
        </div>
        {printMessage ? <p className="inline-notice">{printMessage}</p> : null}

        {jobs.length > 0 ? (
          <fieldset>
            <legend>{t('print.jobs')}</legend>
            <div className="job-toolbar">
              <span className="muted">{t('print.jobCount', { shown: jobs.length, count: jobTotal })}</span>
              <button type="button" onClick={() => void clearJobs()}>
                {t('print.cleanUp')}
              </button>
            </div>
            <ul className="job-list">
              {jobs.map((job) => (
                <li key={job.request_id}>
                  <span className="job-title">{job.title || t('print.job', { number: job.job_id })}</span>
                  <span className="job-meta">
                    {job.printer} · {jobStatus(t, job)}
                    {/* "job-completed-successfully" adds nothing to "completed". */}
                    {job.state_message && job.state_code !== 9 ? ` · ${job.state_message}` : ''}
                  </span>
                  {job.reachable && !job.finished ? (
                    <button
                      type="button"
                      className="linklike"
                      onClick={async () => {
                        await printerApi.cancelJob(job.request_id)
                        await loadJobs()
                      }}
                    >
                      {t('print.cancel')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {jobs.length < jobTotal ? (
              <button type="button" className="job-more" onClick={() => setJobLimit((current) => current + JOB_PAGE)}>
                {t('print.showMore')}
              </button>
            ) : null}
          </fieldset>
        ) : null}

        {problem ? <p className="inline-warning">{problem}</p> : null}
      </div>

      {managing ? (
        <PrintersDialog
          onClose={() => {
            setManaging(false)
            void loadPrinters()
          }}
          onChanged={(list) => setPrinterList(list)}
        />
      ) : null}

      <div className="print-preview">
        <div className="preview-stage">
          {info ? (
            <img
              className={landscape ? 'preview-sheet landscape' : 'preview-sheet'}
              src={api.previewImageUrl(detail.id, printSettings, page, 110, detail.revision)}
              alt={t('print.page', { number: page, total: info?.pages ?? '–' })}
            />
          ) : (
            <p className="placeholder">
              {t(busy ? 'print.previewBusy' : 'print.noPreview')}
            </p>
          )}
        </div>
        <div className="preview-nav">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            ◀
          </button>
          <span>{t('print.page', { number: page, total: info?.pages ?? '–' })}</span>
          <button type="button" disabled={!info || page >= info.pages} onClick={() => setPage((value) => value + 1)}>
            ▶
          </button>
        </div>
      </div>
    </div>
  )
}
