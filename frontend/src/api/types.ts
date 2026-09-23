/** Types that mirror the backend's Pydantic models.
 *
 *  As long as these are maintained by hand: change them together with the
 *  API. Generating them from OpenAPI is a later step.
 */

export type ColorSpec = { color?: string | null; field?: string | null }

export type Shadow = {
  enabled: boolean
  x_pt: number
  y_pt: number
  opacity: number
  color: ColorSpec
}

type Base = {
  id?: string | null
  x_pt: number
  y_pt: number
  affine: number[]
  shadow: Shadow
}

type Sized = Base & { w_pt: number; h_pt: number; lock_aspect_ratio: boolean }

export type TextObject = Sized & {
  type: 'text'
  lines: string[]
  font_family: string
  font_size: number
  font_weight: 'normal' | 'bold'
  font_italic: boolean
  font_underline: boolean
  color: ColorSpec
  line_spacing: number
  align: 'left' | 'center' | 'right'
  valign: 'top' | 'center' | 'bottom'
  wrap: 'word' | 'anywhere' | 'none'
  auto_shrink: boolean
}

export type BoxObject = Sized & {
  type: 'box'
  line_width_pt: number
  line_color: ColorSpec
  fill_color: ColorSpec
}

export type EllipseObject = Omit<BoxObject, 'type'> & { type: 'ellipse' }

export type LineObject = Base & {
  type: 'line'
  dx_pt: number
  dy_pt: number
  line_width_pt: number
  line_color: ColorSpec
}

export type ImageObject = Sized & {
  type: 'image'
  src?: string | null
  src_field?: string | null
  embedded: boolean
}

export type BarcodeObject = Sized & {
  type: 'barcode'
  backend: string
  style: string
  show_text: boolean
  checksum: boolean
  data: string
  color: ColorSpec
}

export type UnsupportedObject = Base & { type: 'unsupported'; tag: string; reason: string }

export type DocumentObject =
  | TextObject
  | BoxObject
  | EllipseObject
  | LineObject
  | ImageObject
  | BarcodeObject
  | UnsupportedObject

export type DocumentContent = { rotate: boolean; objects: DocumentObject[] }

export type Limitation = {
  code: string
  message: string
  params?: Record<string, string>
  blocks_editing: boolean
}

export type MergeSpec = {
  type: string
  src?: string | null
  available: boolean
  source_path?: string | null
}

export type VariableSpec = {
  type: 'numeric' | 'string'
  name: string
  value: string
  increment: string
  step_size: string
}

export type EmbeddedFile = { name: string; mimetype: string; size_bytes: number }

export type DocumentInfo = {
  id: string
  name: string
  revision: number
  created_at: string
  updated_at: string
  template_brand: string
  template_part: string
  template_description: string
  merge_source_path?: string | null
  /** The .glabels file in the shared folder; empty until it has been given a name. */
  file_path?: string | null
}

/** State of the linked file; see `DocumentDetail` in the backend. */
export type FileState = 'none' | 'linked' | 'conflict' | 'missing'

/** A project in the list, with the state of its file. */
export type DocumentListItem = DocumentInfo & { file_state: FileState; rotate: boolean }

export type Markup = { type: string; values: Record<string, number> }

export type DocumentDetail = DocumentInfo & {
  file_state: FileState
  label_width_pt: number
  label_height_pt: number
  label_shape: string
  label_round_pt: number
  label_radius_pt?: number | null
  label_hole_pt?: number | null
  markups: Markup[]
  content: DocumentContent
  merge?: MergeSpec | null
  variables: VariableSpec[]
  embedded_files: EmbeddedFile[]
  limitations: Limitation[]
}

export type Layout = {
  nx: number
  ny: number
  x0_pt: number
  y0_pt: number
  dx_pt: number
  dy_pt: number
}

export type Frame = {
  id: string
  shape: 'rectangle' | 'round' | 'ellipse' | 'cd' | 'continuous'
  width_pt?: number | null
  height_pt?: number | null
  radius_pt?: number | null
  hole_pt?: number | null
  round_pt?: number | null
  x_waste_pt: number
  y_waste_pt: number
  min_height_pt?: number | null
  max_height_pt?: number | null
  default_height_pt?: number | null
  markups: Markup[]
  layouts: Layout[]
}

export type PaperSize = {
  id: string
  name: string
  width_pt: number
  height_pt: number
  pwg_class?: string | null
}

export type Template = {
  brand: string
  part: string
  description: string
  size?: string | null
  page_width_pt?: number | null
  page_height_pt?: number | null
  roll_width_pt?: number | null
  categories: string[]
  product_url?: string | null
  frames: Frame[]
  equiv_part?: string | null
  source: 'system' | 'user'
}

export type Health = {
  status: string
  version: string
  templates: number
  brands: number
  renderer_mode: string
  renderer_available: boolean
  fonts: number
  files_dir: string
  files_available: boolean
  printing_available: boolean
  printers: number
  upstream_commit?: string | null
  /** GLW_PUBLIC_URL: the address links to this installation use, if set. */
  public_url?: string | null
}

export type PrintSettings = {
  sheets?: number | null
  copies?: number | null
  first: number
  outlines: boolean
  crop_marks: boolean
  reverse: boolean
  collate: boolean
  group_per_page: boolean
}

export type PreviewInfo = {
  revision: number
  pages: number
  page_width_pt: number
  page_height_pt: number
}

export type MergePreview = {
  type: string
  label: string
  source_path?: string | null
  keys: string[]
  records: Record<string, string>[]
  record_count: number
  truncated: boolean
}
