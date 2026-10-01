/** Choosing a colour the way gLabels does: a small palette under the button.
 *
 *  The standard colours are upstream's (ColorPaletteDialog: the Tango
 *  palette, light to dark, and a row of greys), then the colours used last,
 *  then "no colour" where that makes sense, and a hex code or the system's
 *  colour window for anything else. One click picks a colour and closes.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'

const STANDARD = [
  ['#ef2929', '#fcaf3e', '#fce94f', '#8ae234', '#729fcf', '#ad7fa8', '#e9b96e', '#888a85', '#eeeeec'],
  ['#cc0000', '#f57900', '#edd400', '#73d216', '#3465a4', '#75507b', '#c17d11', '#555753', '#d3d7cf'],
  ['#a40000', '#ce5c00', '#c4a000', '#4e9a06', '#204a87', '#5c3566', '#8f5902', '#2e3436', '#babdb6'],
  ['#000000', '#2e3436', '#555753', '#888a85', '#babdb6', '#d3d7cf', '#eeeeec', '#f3f3f3', '#ffffff'],
]

const RECENT_KEY = 'glabels-web.recent-colors'
const RECENT_COUNT = 9

function recentColors(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((item) => typeof item === 'string').slice(0, RECENT_COUNT) : []
  } catch {
    return []
  }
}

function remember(rgb: string) {
  const next = [rgb, ...recentColors().filter((item) => item !== rgb)].slice(0, RECENT_COUNT)
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
}

/** "#abc", "aabbcc" or "#AABBCC" as "#aabbcc"; null when it is no colour. */
export function normalizeHex(text: string): string | null {
  const bare = text.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(bare)) return `#${bare.split('').map((c) => c + c).join('')}`
  if (/^[0-9a-f]{6}$/.test(bare)) return `#${bare}`
  return null
}

export function ColorPicker({
  value,
  onChange,
  allowNone = true,
}: {
  /** "#rrggbbaa"; an alpha of 00 is no colour. */
  value: string
  onChange: (value: string) => void
  allowNone?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rgb = value.slice(0, 7)
  const none = value.length === 9 && value.slice(7) === '00'
  const [hex, setHex] = useState(rgb)
  const wrapper = useRef<HTMLSpanElement | null>(null)
  const popup = useRef<HTMLDivElement | null>(null)
  // The palette floats above the page, so a panel that clips its contents
  // cannot cut it off; it stays inside the window, and opens above the
  // swatch when there is no room below.
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null)
      return
    }
    const anchor = wrapper.current?.getBoundingClientRect()
    const box = popup.current?.getBoundingClientRect()
    if (!anchor || !box) return
    const margin = 8
    const left = Math.min(Math.max(margin, anchor.left), window.innerWidth - box.width - margin)
    const below = anchor.bottom + 4
    const top =
      below + box.height + margin <= window.innerHeight ? below : Math.max(margin, anchor.top - box.height - 4)
    setPlace({ left, top })
  }, [open])

  useEffect(() => setHex(rgb), [rgb, open])

  // Clicking beside the palette or Escape closes it, choosing nothing.
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!wrapper.current?.contains(target) && !popup.current?.contains(target)) setOpen(false)
    }
    // Scrolling or resizing would leave it floating in the wrong place.
    const away = () => setOpen(false)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  }, [open])

  const pick = (color: string) => {
    remember(color)
    onChange(`${color}ff`)
    setOpen(false)
  }

  const recent = open ? recentColors() : []

  const palette = (
    <div
      ref={popup}
      className="color-popup"
      role="dialog"
      style={place ? { left: place.left, top: place.top } : { visibility: 'hidden', left: 0, top: 0 }}
    >
      <div className="color-group">{t('color.standard')}</div>
      <div className="color-grid">
        {STANDARD.flat().map((color, index) => (
          <button
            key={`${color}-${index}`}
            type="button"
            className={!none && color === rgb ? 'color-cell current' : 'color-cell'}
            style={{ background: color }}
            title={color}
            onClick={() => pick(color)}
          />
        ))}
      </div>
      <div className="color-group">{t('color.recent')}</div>
      <div className="color-grid">
        {Array.from({ length: RECENT_COUNT }, (_, index) => recent[index]).map((color, index) =>
          color ? (
            <button
              key={`${color}-${index}`}
              type="button"
              className="color-cell"
              style={{ background: color }}
              title={color}
              onClick={() => pick(color)}
            />
          ) : (
            <span key={`empty-${index}`} className="color-cell empty" />
          ),
        )}
      </div>
      {allowNone ? (
        <button
          type="button"
          className="color-none-button"
          onClick={() => {
            onChange(`${rgb}00`)
            setOpen(false)
          }}
        >
          <span className="color-swatch none small" /> {t('objectEditor.noColor')}
        </button>
      ) : null}
      <form
        className="color-custom"
        onSubmit={(event) => {
          event.preventDefault()
          const color = normalizeHex(hex)
          if (color) pick(color)
        }}
      >
        <input
          value={hex}
          aria-label={t('color.hex')}
          spellCheck={false}
          className={normalizeHex(hex) ? undefined : 'invalid'}
          onChange={(event) => setHex(event.target.value)}
        />
        <button type="submit" disabled={!normalizeHex(hex)}>
          {t('common.ok')}
        </button>
        <label className="color-system" title={t('color.system')}>
          {/* The system window reports every step while you drag; apply
              those, and remember the colour once it closes. */}
          <input
            type="color"
            value={rgb}
            onChange={(event) => onChange(`${event.target.value}ff`)}
            onBlur={(event) => remember(event.target.value)}
          />
          …
        </label>
      </form>
    </div>
  )

  return (
    <span className="color-picker" ref={wrapper}>
      <button
        type="button"
        className={none ? 'color-swatch none' : 'color-swatch'}
        style={none ? undefined : { background: rgb }}
        title={none ? t('objectEditor.noColor') : rgb}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      <span className="color-value">{none ? t('objectEditor.noColor') : rgb}</span>
      {open ? createPortal(palette, document.body) : null}
    </span>
  )
}
