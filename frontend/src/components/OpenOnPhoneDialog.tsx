/** "Open on phone": a QR code for the phone view of the open label.
 *
 *  Scanning it with the phone's camera lands right at the print button. The
 *  address comes from GLW_PUBLIC_URL when the installation sets it;
 *  otherwise from how this browser reached the application. If that is
 *  localhost, a phone cannot use it, and the dialog says so.
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useT } from '../i18n'
import { mobilePath, openMobileView } from '../mobile/view'

function reachableFromPhone(hostname: string): boolean {
  return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
}

export function OpenOnPhoneDialog({
  docId,
  publicUrl,
  onClose,
}: {
  /** The label to open; without one the phone gets the list. */
  docId: string | null
  /** GLW_PUBLIC_URL, when the installation sets one. */
  publicUrl?: string | null
  onClose: () => void
}) {
  const t = useT()
  const base = publicUrl || window.location.origin
  const url = `${base}${mobilePath(docId)}`
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then((data) => {
        if (!cancelled) setImage(data)
      })
      .catch(() => {
        if (!cancelled) setImage(null)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal
      aria-label={t('phone.title')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="modal phone-dialog">
        <div className="modal-title">{t('phone.title')}</div>
        <div className="modal-body phone-body">
          <div className="phone-qr">{image ? <img src={image} alt={url} width={240} height={240} /> : null}</div>
          <p>{t(docId ? 'phone.scanLabel' : 'phone.scanList')}</p>
          <code className="phone-url">{url}</code>
          {publicUrl || reachableFromPhone(window.location.hostname) ? null : (
            <p className="inline-notice">{t('phone.localhost')}</p>
          )}
        </div>
        <div className="modal-buttons">
          <button type="button" onClick={() => openMobileView(docId)}>
            {t('phone.here')}
          </button>
          <span className="spacer" />
          <button type="button" className="default" autoFocus onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
