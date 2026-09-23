/** The phone view: pick a label, change its text, print.
 *
 *  Designing labels happens in the full editor; on a phone you want to
 *  print one again, perhaps with different text. So this view has two
 *  screens and nothing else: the list of labels, and one label with its
 *  text, a preview, the number of copies and a print button. The default
 *  printer is preselected, text changes are saved as you type, and the
 *  print button always prints what the preview shows.
 *
 *  Every label has its own address (`/m/<id>`), so it can be bookmarked or
 *  put on the home screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { newRequestId, printers as printerApi, type Printer } from '../api/printers'
import type { DocumentDetail, DocumentListItem, DocumentObject, PrintSettings, TextObject } from '../api/types'
import { applyFonts, fetchFonts } from '../app/fonts'
import { DEFAULT_PRINT_SETTINGS } from '../app/session'
import { useT } from '../i18n'
import './mobile.css'
import { useUprightSrc } from './upright'
import { MOBILE_BASE, openFullEditor } from './view'

function idFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/m\/([0-9a-f-]{36})\/?$/i)
  return match ? match[1] : null
}

/** The printer this phone chose last. */
const PRINTER_KEY = 'glabels-web.printer'

// The preview is page 1 of exactly what gets printed.
const PREVIEW_SETTINGS: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, copies: 1, sheets: null }

export function MobileApp() {
  const [docId, setDocId] = useState<string | null>(() => idFromPath(window.location.pathname))

  // The label's own fonts, so each text field shows the font it prints in.
  useEffect(() => {
    fetchFonts()
      .then(applyFonts)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onPop = () => setDocId(idFromPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((id: string | null) => {
    window.history.pushState(null, '', id ? `${MOBILE_BASE}/${id}` : MOBILE_BASE)
    setDocId(id)
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="mobile">
      {docId ? <LabelScreen id={docId} onBack={() => go(null)} /> : <ListScreen onOpen={go} />}
    </div>
  )
}

// ------------------------------------------------------------------ list
function ListScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT()
  const [labels, setLabels] = useState<DocumentListItem[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    api
      .listDocuments()
      .then(setLabels)
      .catch((error) => setProblem(String(error instanceof Error ? error.message : error)))
  }, [])

  return (
    <>
      <header className="mobile-bar">
        <h1>{t('mobile.labels')}</h1>
        <DesktopButton />
      </header>
      <main className="mobile-body">
        {problem ? <p className="mobile-problem">{problem}</p> : null}
        {labels && labels.length === 0 ? <p className="mobile-note">{t('mobile.noLabels')}</p> : null}
        <ul className="mobile-list">
          {(labels ?? []).map((label) => (
            <ListItem key={label.id} label={label} onOpen={onOpen} />
          ))}
        </ul>
      </main>
    </>
  )
}

function ListItem({ label, onOpen }: { label: DocumentListItem; onOpen: (id: string) => void }) {
  const preview = useUprightSrc(
    api.previewImageUrl(label.id, PREVIEW_SETTINGS, 1, 40, label.revision),
    label.rotate,
  )
  return (
    <li>
      <button type="button" onClick={() => onOpen(label.id)}>
        {preview ? <img src={preview} alt="" loading="lazy" /> : <span className="mobile-thumb" />}
        <span className="mobile-list-text">
          <strong>{label.name}</strong>
          <span>
            {label.template_brand} {label.template_part}
          </span>
        </span>
      </button>
    </li>
  )
}

// ----------------------------------------------------------------- label
type PrintState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'waiting'; requestId: string; printer: string }
  | { phase: 'done'; printer: string }
  | { phase: 'failed'; reason: string }

function textObjects(objects: DocumentObject[]): TextObject[] {
  return objects.filter((object): object is TextObject => object.type === 'text')
}

function LabelScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT()
  const [detail, setDetail] = useState<DocumentDetail | null>(null)
  const [texts, setTexts] = useState<string[]>([])
  const [fontsOf, setFontsOf] = useState<TextObject[]>([])
  const [copies, setCopies] = useState(1)
  const [printerList, setPrinterList] = useState<Printer[] | null>(null)
  const [printer, setPrinter] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [printState, setPrintState] = useState<PrintState>({ phase: 'idle' })

  // Typing saves after a short pause; printing waits for that save.
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const pendingSave = useRef<Promise<void> | null>(null)
  const latest = useRef({ detail, texts })
  useEffect(() => {
    latest.current = { detail, texts }
  }, [detail, texts])

  useEffect(() => {
    api
      .getDocument(id)
      .then((loaded) => {
        setDetail(loaded)
        setTexts(textObjects(loaded.content.objects).map((object) => object.lines.join('\n')))
        setFontsOf(textObjects(loaded.content.objects))
      })
      .catch((error) => setProblem(String(error instanceof Error ? error.message : error)))
    printerApi
      .list(false)
      .then((list) => {
        setPrinterList(list.printers)
        // The printer this phone used last, if it still exists; otherwise the
        // default. A phone is usually next to one particular printer.
        const remembered = window.localStorage.getItem(PRINTER_KEY)
        const known = list.printers.some((item) => item.name === remembered)
        setPrinter(
          known && remembered
            ? remembered
            : (list.printers.find((item) => item.is_default)?.name ?? list.printers[0]?.name ?? ''),
        )
      })
      .catch(() => setPrinterList([]))
  }, [id])

  const save = useCallback(async () => {
    const { detail: current, texts: values } = latest.current
    if (!current || !dirty.current) return
    dirty.current = false
    setSaving(true)
    let index = 0
    const objects = current.content.objects.map((object) => {
      if (object.type !== 'text') return object
      const value = values[index++] ?? ''
      return { ...object, lines: value.split('\n') }
    })
    try {
      const saved = await api.saveDocument(current.id, { rotate: current.content.rotate, objects })
      setDetail(saved)
    } catch (error) {
      dirty.current = true
      setProblem(String(error instanceof Error ? error.message : error))
    } finally {
      setSaving(false)
    }
  }, [])

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (dirty.current) pendingSave.current = save()
    await pendingSave.current
  }, [save])

  // Leaving the screen must not lose the last few characters.
  useEffect(() => () => void flush(), [flush])

  const changeText = (index: number, value: string) => {
    setTexts((current) => current.map((text, i) => (i === index ? value : text)))
    setPrintState({ phase: 'idle' })
    dirty.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      pendingSave.current = save()
    }, 700)
  }

  const print = async () => {
    if (!detail || !printer) return
    setProblem(null)
    setPrintState({ phase: 'sending' })
    try {
      await flush()
      const requestId = newRequestId()
      await printerApi.print(
        detail.id,
        printer,
        { ...DEFAULT_PRINT_SETTINGS, copies, sheets: null, first: 1 },
        requestId,
      )
      setPrintState({ phase: 'waiting', requestId, printer })
    } catch (error) {
      setPrintState({ phase: 'failed', reason: String(error instanceof Error ? error.message : error) })
    }
  }

  // Follow the job until the printer says it is finished.
  useEffect(() => {
    if (printState.phase !== 'waiting') return
    let stopped = false
    const started = Date.now()
    const check = async () => {
      try {
        const { items } = await printerApi.jobs(10)
        const job = items.find((item) => item.request_id === printState.requestId)
        if (stopped || !job) return
        if (job.state_code === 9) setPrintState({ phase: 'done', printer: printState.printer })
        else if (job.state_code === 7 || job.state_code === 8)
          setPrintState({ phase: 'failed', reason: job.state_message || job.state })
      } catch {
        // A hiccup while asking is not a failed print; try again.
      }
    }
    const interval = window.setInterval(() => {
      // Give up following after two minutes; the job itself carries on.
      if (Date.now() - started > 120_000) window.clearInterval(interval)
      else void check()
    }, 1500)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [printState])

  const preview = useUprightSrc(
    detail ? api.previewImageUrl(detail.id, PREVIEW_SETTINGS, 1, 150, detail.revision) : '',
    detail?.content.rotate ?? false,
  )

  const locked = detail?.limitations.some((limitation) => limitation.blocks_editing) ?? false
  const busy = printState.phase === 'sending' || printState.phase === 'waiting'

  return (
    <>
      <header className="mobile-bar">
        <button type="button" className="mobile-back" onClick={onBack}>
          ‹ {t('mobile.labels')}
        </button>
        <h1>{detail?.name ?? ''}</h1>
        <DesktopButton />
      </header>

      <main className="mobile-body">
        {problem ? <p className="mobile-problem">{problem}</p> : null}

        {detail ? (
          <>
            <div className="mobile-preview">
              {preview ? <img src={preview} alt={detail.name} /> : null}
              {saving ? <span className="mobile-saving">{t('mobile.saving')}</span> : null}
            </div>

            {texts.length === 0 ? <p className="mobile-note">{t('mobile.noText')}</p> : null}
            {locked ? <p className="mobile-note">{t('mobile.readOnly')}</p> : null}
            {texts.map((text, index) => (
              <label key={index} className="mobile-field">
                {texts.length > 1 ? <span>{t('mobile.text', { number: index + 1 })}</span> : null}
                <textarea
                  style={fontStyle(fontsOf[index])}
                  value={text}
                  rows={Math.max(2, text.split('\n').length)}
                  disabled={locked}
                  onChange={(event) => changeText(index, event.target.value)}
                />
              </label>
            ))}

            <div className="mobile-copies">
              <span>{t('mobile.copies')}</span>
              <button type="button" aria-label="−" disabled={copies <= 1} onClick={() => setCopies(copies - 1)}>
                −
              </button>
              <output>{copies}</output>
              <button type="button" aria-label="+" disabled={copies >= 99} onClick={() => setCopies(copies + 1)}>
                +
              </button>
            </div>

            {printerList && printerList.length === 0 ? (
              <p className="mobile-note">{t('mobile.noPrinter')}</p>
            ) : null}
            {printerList && printerList.length === 1 ? (
              <div className="mobile-field">
                <span>{t('mobile.printer')}</span>
                <p className="mobile-printer">{printer}</p>
              </div>
            ) : null}
            {printerList && printerList.length > 1 ? (
              <label className="mobile-field">
                <span>{t('mobile.printer')}</span>
                <select
                  value={printer}
                  onChange={(event) => {
                    setPrinter(event.target.value)
                    window.localStorage.setItem(PRINTER_KEY, event.target.value)
                  }}
                >
                  {printerList.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}
      </main>

      {detail ? (
        <footer className="mobile-action">
          <PrintStatus state={printState} />
          <button type="button" className="mobile-print" disabled={!printer || busy} onClick={() => void print()}>
            {busy ? t('mobile.sending') : t('mobile.print', { count: copies })}
          </button>
        </footer>
      ) : null}
    </>
  )
}

/** The object's font in its field; the size stays 16 px so iOS does not zoom. */
function fontStyle(object: TextObject | undefined) {
  if (!object) return undefined
  return {
    fontFamily: `${JSON.stringify(object.font_family)}, system-ui, sans-serif`,
    fontWeight: object.font_weight,
    fontStyle: object.font_italic ? 'italic' : 'normal',
  }
}

function PrintStatus({ state }: { state: PrintState }) {
  const t = useT()
  switch (state.phase) {
    case 'waiting':
      return <p className="mobile-status">{t('mobile.printing', { printer: state.printer })}</p>
    case 'done':
      return <p className="mobile-status done">✓ {t('mobile.printed', { printer: state.printer })}</p>
    case 'failed':
      return <p className="mobile-status failed">{t('mobile.failed', { reason: state.reason })}</p>
    default:
      return null
  }
}

/** Back to the full editor; the device remembers that choice. */
function DesktopButton() {
  const t = useT()
  return (
    <button type="button" className="mobile-link" onClick={openFullEditor}>
      {t('mobile.desktop')}
    </button>
  )
}
