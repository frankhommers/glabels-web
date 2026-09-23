# Compatibility with gLabels Qt

Measured against upstream commit `554c9f04389f7a1afa18685cab015273f0b21d94`,
file format `Glabels-document version="4.0"`.

## What has been shown

| Area | Status | Evidence |
| --- | --- | --- |
| Headless PDF output in the container | shown | `QT_QPA_PLATFORM=offscreen`; upstream fixtures render without a display server |
| Same output as upstream | shown for 2 fixtures | `simple-text-liberation-sans` and `simple-code39` are **pixel identical** to the bundled reference PDFs when rasterised at 900 px |
| Round trip without semantic loss | shown for 5 fixtures | `backend/tests/test_document_roundtrip.py` compares attribute by attribute, with lengths in points |
| Keeping unknown content | shown | fixture `unknown-extras.glabels` with an unknown attribute, an unknown object type and an unknown section |
| Our output readable by the Qt parser | shown | an exported file is read and printed by `glabels-batch-qt` |
| User fonts in the print | shown | an uploaded font appears as `/BaseFont` in the PDF |
| Merging with a CSV source | shown | four records give four different labels on one sheet |
| Printing over IPP | shown against a simulator | adding, printing, state and cancelling; the printer receives the PDF with the embedded font |
| Text alignment | shown | centred text is written as `hcenter`/`vcenter`, like `XmlUtil::setAlignmentAttr`; the rendered text sits in the middle of the label |

## What has not been shown yet

- Opening our files in the **graphical** desktop app. The renderer shares the
  same parser (`model/XmlLabelParser`), so that is a strong signal, but no
  replacement for a real test on a desktop.
- Printing on physical hardware: measuring sizes, checking position and
  scanning a barcode. A DYMO LabelWriter 450 has been used, but not measured.
- Round trip of documents with embedded images or variables. That data is
  kept, but not covered by fixtures yet.
- Importing gLabels 3 documents.

## Objects and properties

| Object type | Read | Edit | Write | Note |
| --- | --- | --- | --- | --- |
| `Object-text` | yes | yes | yes | Lines, font, size, style, colour, alignment, line spacing, wrap, auto-shrink |
| `Object-box` | yes | yes | yes | Line and fill, including field references |
| `Object-ellipse` | yes | yes | yes | same |
| `Object-line` | yes | yes | yes | `dx`/`dy`, line width and colour |
| `Object-barcode` | yes | yes | yes | Backend and style are never changed silently |
| `Object-image` | yes | no | yes | Source and embedded data are kept; embedded images are drawn in the editor, one from a merge field as a placeholder; new images not yet |
| unknown element | yes | no | unchanged | Shown as a locked object with a notice |

Common to all objects: position, size, `lock_aspect_ratio`, the affine matrix
`a0..a5` and the shadow attributes.

### Units and colours

- Internally everything is in points: 72 pt = 1 inch. Lengths are written in
  the same notation as Qt (`QString::number`, 6 significant digits) with the
  unit `pt` right after.
- Colours are 32-bit integers in **RGBA** order, written as `0x` hexadecimal
  without leading zeros. So `0xff` is opaque black.
- Text alignment is `left`/`hcenter`/`right` and `top`/`vcenter`/`bottom`.
  Upstream reads any other value as left/top.

## Barcodes

The renderer is built with zlib, libqrencode 4.1.1 and libzint 2.15.0.
**GNU Barcode is not available** in the Debian trixie base image.

Consequences:

- Documents with `backend="gnu-barcode"` fall back to upstream's default style
  in the renderer. That is existing upstream behaviour (`Backends::style()`
  silently returns `defaultStyle()`), but it means such a barcode looks
  different than on a desktop *with* GNU Barcode.
- An empty backend (`backend=""`) means the built-in backend. We leave that
  value alone; "filling it in" would change the barcode.

## Known differences and pitfalls

- **Text layout on the canvas is an approximation.** The browser lays out SVG
  text; Qt uses `QTextDocument`. For line breaking, auto-shrink and exact line
  height the print preview is authoritative. The editor does load the same
  font files as the renderer, so the glyphs match.
- **Barcodes are shown as placeholders on the canvas**; the real barcode is in
  the print preview.
- **The upstream CLI does not report every failure with an exit code.** For
  an unreadable project file `glabels-batch-qt` exits with 0 without writing a
  PDF. So the backend always checks for a valid PDF.
- **The upstream renderer crashes (SIGSEGV) on a document without a
  `Template` section.** The backend stops such documents with an
  understandable message.
- **`Label-path` is not supported.** One product in the bundled database
  (Dymo 30915) uses it and is therefore missing from the product list.
- The bundled database has one unreadable length (`round="in"` in
  `online-templates.xml`). Like the desktop app, we fall back to the default
  there instead of skipping the product.

## Merging

Supported source types, with the id as it appears in the file:

| Type in the file | Meaning |
| --- | --- |
| `Text/Comma` | commas, fields numbered `1`, `2`, … |
| `Text/Comma/Line1Keys` | commas, field names on line 1 |
| `Text/Tab`, `Text/Tab/Line1Keys` | tabs |
| `Text/Semicolon`, `Text/Semicolon/Keys` | semicolons |
| `Text/Colon`, `Text/Colon/Line1Keys` | colons |

Points of attention:

- The source is stored in the document as a **bare file name**. Upstream
  resolves it relative to the document's folder, so a `.glabels` with the CSV
  next to it works on a desktop too.
- When rendering we put the chosen source under that same name next to the
  document, and also pass it with `--input`.
- The data preview in the interface is an approximation with Python's CSV
  parser. Upstream has its own parser with backslash escapes; where they
  differ, the renderer's output is authoritative.
- With a merge source, "copies" means the number of copies **per record**,
  exactly as `glabels-batch-qt` uses it.
- We do not know `Data/Fixed`-like or other non-text merge backends; such
  references stay unchanged in the file.
