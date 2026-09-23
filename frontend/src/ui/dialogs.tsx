/** Our own question and message dialogs, in the style of the rest of the
 *  interface.
 *
 *  The browser has `confirm`, `prompt` and `alert`, but they look different
 *  everywhere, cannot be styled and block the page. This is a replacement
 *  with the same calling shape: `await confirm({...})`.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { useT } from '../i18n'

type ConfirmOptions = {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Shows the confirm button as a destructive action. */
  destructive?: boolean
}

type PromptOptions = {
  title: string
  label: string
  value?: string
  placeholder?: string
  confirmLabel?: string
}

type AlertOptions = {
  title: string
  message: ReactNode
  closeLabel?: string
}

type Request =
  | { kind: 'confirm'; options: ConfirmOptions; done: (answer: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; done: (answer: string | null) => void }
  | { kind: 'alert'; options: AlertOptions; done: () => void }

type Dialogs = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  alert: (options: AlertOptions) => Promise<void>
}

const DialogContext = createContext<Dialogs | null>(null)

export function useDialogs(): Dialogs {
  const dialogs = useContext(DialogContext)
  if (!dialogs) throw new Error('useDialogs must be used inside DialogProvider')
  return dialogs
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [request, setRequest] = useState<Request | null>(null)
  const [input, setInput] = useState('')

  const api = useMemo<Dialogs>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          setRequest({ kind: 'confirm', options, done: resolve })
        }),
      prompt: (options) =>
        new Promise<string | null>((resolve) => {
          setInput(options.value ?? '')
          setRequest({ kind: 'prompt', options, done: resolve })
        }),
      alert: (options) =>
        new Promise<void>((resolve) => {
          setRequest({ kind: 'alert', options, done: resolve })
        }),
    }),
    [],
  )

  const close = useCallback(
    (answer: boolean | string | null) => {
      if (!request) return
      setRequest(null)
      if (request.kind === 'confirm') request.done(answer === true)
      else if (request.kind === 'prompt') request.done(typeof answer === 'string' ? answer : null)
      else request.done()
    },
    [request],
  )

  return (
    <DialogContext.Provider value={api}>
      {children}
      {request ? (
        <div
          className="modal-backdrop question-backdrop"
          role="dialog"
          aria-modal
          aria-label={request.options.title}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close(request.kind === 'prompt' ? null : false)
          }}
        >
          <div className="modal question-modal">
            <div className="modal-title">{request.options.title}</div>
            <div className="modal-body">
              {request.kind === 'prompt' ? (
                <div className="form-row">
                  <label>{request.options.label}</label>
                  <input
                    autoFocus
                    value={input}
                    placeholder={request.options.placeholder}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && input.trim()) close(input.trim())
                    }}
                  />
                </div>
              ) : (
                <p className="question-text">{request.options.message}</p>
              )}
            </div>
            <div className="modal-buttons">
              <span className="spacer" />
              {request.kind === 'alert' ? (
                <button type="button" className="default" autoFocus onClick={() => close(true)}>
                  {request.options.closeLabel ?? t('common.close')}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => close(request.kind === 'prompt' ? null : false)}
                  >
                    {(request.kind === 'confirm' && request.options.cancelLabel) || t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className={
                      request.kind === 'confirm' && request.options.destructive
                        ? 'default destructive'
                        : 'default'
                    }
                    autoFocus={request.kind === 'confirm'}
                    disabled={request.kind === 'prompt' && !input.trim()}
                    onClick={() => close(request.kind === 'prompt' ? input.trim() : true)}
                  >
                    {request.options.confirmLabel ?? t('common.ok')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  )
}
