/** Choosing a colour the way gLabels does: a small palette under the button.
 *
 *  The standard colours are upstream's (ColorPaletteDialog: the Tango
 *  palette, light to dark, and a row of greys), then the colours used last,
 *  then "no colour" where that makes sense, and a hex code or the system's
 *  colour window for anything else. One click picks a colour and closes.
 */

import { useEffect, useRef, useState } from 'react'
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
  // Near the right edge of the window the palette opens to the left.
  const [toLeft, setToLeft] = useState(false)

  useEffect(() => setHex(rgb), [rgb, open])

  // Clicking beside the palette or Escape closes it, choosing nothing.
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  const pick = (color: string) => {
    remember(color)
    onChange(`${color}ff`)
    setOpen(false)
  }

  const recent = open ? recentColors() : []

  return (
    <span className="color-picker" ref={wrapper}>
      <button
        type="button"
        className={none ? 'color-swatch none' : 'color-swatch'}
        style={none ? undefined : { background: rgb }}
        title={none ? t('objectEditor.noColor') : rgb}
        aria-expanded={open}
        onClick={() => {
          const box = wrapper.current?.getBoundingClientRect()
          setToLeft(Boolean(box && box.left + 250 > window.innerWidth))
          setOpen(!open)
        }}
      />
      <span className="color-value">{none ? t('objectEditor.noColor') : rgb}</span>
      {open ? (
        <div className={toLeft ? 'color-popup to-left' : 'color-popup'} role="dialog">
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
      ) : null}
    </span>
  )
}
