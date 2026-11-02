/** Which view a device gets: the phone view or the full editor. */

/** Where the phone view lives; `/m/<id>` opens one label directly. */
export const MOBILE_BASE = '/m'

/** A phone: small screen and a finger for a pointer. */
export function isPhone(): boolean {
  return window.matchMedia('(max-width: 700px) and (pointer: coarse)').matches
}

/** The full editor on a phone is a deliberate choice; remember it. */
const VIEW_KEY = 'glabels-web.view'

export function prefersDesktop(): boolean {
  return window.localStorage.getItem(VIEW_KEY) === 'desktop'
}

/** The full editor keeps the open label in its address, so a reload or a
 *  switch between the two views lands on the same label. */
const LABEL_PARAM = 'label'

export function editorPath(id?: string | null): string {
  return id ? `/?${LABEL_PARAM}=${encodeURIComponent(id)}` : '/'
}

/** The label named in the full editor's address, if any. */
export function labelInAddress(): string | null {
  return new URLSearchParams(window.location.search).get(LABEL_PARAM)
}

export function openFullEditor(id?: string | null): void {
  window.localStorage.setItem(VIEW_KEY, 'desktop')
  window.location.assign(editorPath(id))
}

/** The phone address of one label, or of the list without an id. */
export function mobilePath(id?: string | null): string {
  return id ? `${MOBILE_BASE}/${id}` : MOBILE_BASE
}

export function openMobileView(id?: string | null): void {
  window.localStorage.removeItem(VIEW_KEY)
  window.location.assign(mobilePath(id))
}
