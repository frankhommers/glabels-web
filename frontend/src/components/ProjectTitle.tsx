/** The project name in the toolbar, editable in place.
 *
 *  A click turns it into an input. Enter or clicking away saves, Escape
 *  keeps the old name. An empty name is not saved.
 */

import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

export function ProjectTitle({
  name,
  editing,
  onEditingChange,
  onRename,
}: {
  name: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onRename: (name: string) => Promise<void>
}) {
  const t = useT()

  if (editing) {
    return (
      <NameInput
        name={name}
        onDone={(renamed) => {
          onEditingChange(false)
          if (renamed && renamed !== name) void onRename(renamed)
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className="window-title editable"
      title={t('title.rename')}
      onClick={() => onEditingChange(true)}
    >
      {name}
    </button>
  )
}

/** The input starts afresh with the current name every time. */
function NameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const t = useT()
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Enter followed by losing focus must not save twice.
  const doneRef = useRef(false)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const finish = (keep: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    onDone(keep ? value.trim() || null : null)
  }

  return (
    <input
      ref={inputRef}
      className="window-title-input"
      aria-label={t('title.name')}
      value={value}
      maxLength={200}
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') finish(false)
        // Editor shortcuts (Delete, Ctrl+Z…) must not work here.
        event.stopPropagation()
      }}
    />
  )
}
