import { useEffect, useRef, useState } from 'react'

export type MenuItem =
  | { kind: 'separator' }
  | {
      kind: 'action'
      label: string
      shortcut?: string
      disabled?: boolean
      checked?: boolean
      onSelect: () => void
    }

export type Menu = { label: string; items: MenuItem[] }

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const container = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(null)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEscape)
    }
  }, [])

  return (
    <div className="menubar" ref={container}>
      {menus.map((menu) => (
        <div key={menu.label} className="menubar-item">
          <button
            type="button"
            className={open === menu.label ? 'menubar-button open' : 'menubar-button'}
            onClick={() => setOpen(open === menu.label ? null : menu.label)}
            onMouseEnter={() => open !== null && setOpen(menu.label)}
          >
            {menu.label}
          </button>
          {open === menu.label ? (
            <div className="menu-popup" role="menu">
              {menu.items.map((item, index) =>
                item.kind === 'separator' ? (
                  <hr key={`sep-${index}`} />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null)
                      item.onSelect()
                    }}
                  >
                    <span className="menu-check">{item.checked ? '✓' : ''}</span>
                    <span className="menu-label">{item.label}</span>
                    <span className="menu-shortcut">{item.shortcut ?? ''}</span>
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
