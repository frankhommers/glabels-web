# gLabels Web

A web interface for gLabels labels. The interface is rebuilt in
React/TypeScript and follows the layout of [gLabels Qt](https://github.com/j-evins/glabels-qt);
documents and prints go through the original Qt renderer, so files stay
interchangeable with the desktop app.

This is an independent project, not part of or endorsed by the gLabels
project.

## What works

- Product selection from the complete gLabels database (1481 products, 32
  brands).
- Creating user product definitions, deriving them from an existing product,
  editing and deleting them; stored as XML in the shared folder, and therefore
  interchangeable with the desktop app.
- An editor with text, box, ellipse, line and barcode; selecting, dragging,
  resizing, rotating, flipping, aligning, stacking order, cut/paste and undo.
- Opening, editing, saving and exporting `.glabels` files in format 4.0,
  keeping unknown nodes, attributes and object types.
- Saving like on the desktop: a project lives in a `.glabels` file in the
  shared folder. The first save asks for a folder and a name; after that every
  save updates that file. If someone changes the file outside the app, it is
  not overwritten and the user chooses which version stays.
- Autosave: changes are written after a short pause, and always before a
  preview or print. Every save is a revision; unchanged content does not make
  a new one.
- Designing labels horizontally or vertically (Properties ▸ Orientation).
- Print preview: a rasterisation of exactly the PDF that gets printed, made by
  `glabels-batch-qt` from the same pinned upstream source.
- Adding user fonts; they are used both on the canvas and by the renderer.
- A shared folder with a file dialog: choosing merge sources, opening and
  saving `.glabels` files, and managing fonts.
- Merging with CSV and tab separated files, including a field overview, a data
  preview and the merge controls when printing.
- Printer management over IPP: adding a printer after checking with the
  device, choosing the default printer, printing, following and cancelling
  jobs. The PDF goes straight to the printer; no print service runs. The
  printer's media size that matches the label is sent along, so a label
  printer does not scale to its default label.
- The interface in English and Dutch.
- A phone view for printing on the go: pick a label, change its text,
  choose the number of copies and print. See *On a phone* below.

## What does not work yet

- Printing on real hardware has only been tried with a DYMO LabelWriter 450
  behind CUPS; choosing the media size was added afterwards and has not been
  checked on paper yet. See [docs/printers.md](docs/printers.md).
- Printers that do not accept PDF. Nothing is converted; such printers are
  refused with an explanation when adding them.
- Automatic printer discovery (mDNS). The IPP address is entered by hand.
- Creating image objects and editing variables. Existing values in opened
  documents are kept unchanged.

## Quick start (containers)

Ready-made images for amd64 and arm64 are on the GitHub Container Registry:

```bash
docker compose pull app
docker compose up -d app
open http://127.0.0.1:8080
```

`compose.yaml` uses `ghcr.io/frankhommers/glabels-web:latest`. Tags follow
the releases (`v1.2.3`, `1.2`); `latest` is the newest build of `main`.

To build the images yourself instead:

```bash
docker compose build renderer   # builds glabels-batch-qt from upstream (takes a while)
docker compose build app
docker compose up -d app
```

Documents and revisions live on the `glabels-data` volume
(`/var/lib/glabels-web` in the container). The shared folder is mounted from
`./data/shared` on the host; that is where projects, merge sources, fonts
(subfolder `fonts`) and product definitions (subfolder `templates`) live. On
Linux the folder must be writable for the container user:

```bash
mkdir -p data/shared/fonts
sudo chown -R 10001:10001 data/shared
```

Only the application port is published, and it is bound to `127.0.0.1` by
default. The application has no login of its own: everyone who reaches it can
use it. If it must be reachable from a shared or external network, put a
reverse proxy in front of it that terminates HTTPS and handles
authentication.

## Development

```bash
# once: build the renderer and fetch the template database + fonts
docker build -f docker/renderer.Dockerfile -t glabels-web/renderer:dev .
./scripts/sync-vendor.sh

# backend
cd backend && uv venv .venv && uv pip install -e ".[dev]"

# frontend
cd frontend && npm install && npm run build

# run everything together (the API also serves the built interface)
GLW_SYSTEM_TEMPLATES_DIR=$PWD/vendor/glabels-qt/templates \
GLW_BUILTIN_FONTS_DIR=$PWD/vendor/glabels-qt/fonts \
GLW_DATA_DIR=$PWD/.dev-data \
GLW_WEB_ROOT=$PWD/frontend/dist \
GLW_BATCH_DOCKER_IMAGE=glabels-web/renderer:dev \
backend/.venv/bin/python -m uvicorn glabels_web.main:app --app-dir backend --port 8000
```

For frontend work with hot reload: `cd frontend && npm run dev` (proxies
`/api` to `http://127.0.0.1:8000`).

### Tests

```bash
cd backend
GLW_SYSTEM_TEMPLATES_DIR=$PWD/../vendor/glabels-qt/templates .venv/bin/python -m pytest
```

Tests that need the renderer are skipped when the `glabels-web/renderer:dev`
image is missing; they never silently pass without a real PDF.

The frontend is type checked with `npx tsc -b` (part of `npm run build`). Use
`tsc -b`: the project uses TypeScript project references, so a plain
`tsc --noEmit` checks nothing.

## Settings

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `GLW_SYSTEM_TEMPLATES_DIR` | `/opt/glabels/share/glabels-qt/templates` | Upstream product definitions |
| `GLW_USER_TEMPLATES_DIR` | `<GLW_FILES_DIR>/templates` | User product definitions |
| `GLW_BUILTIN_FONTS_DIR` | `/usr/share/fonts` | Bundled fonts |
| `GLW_DATA_DIR` | `/var/lib/glabels-web` | Documents, database and revisions |
| `GLW_FILES_DIR` | `<GLW_DATA_DIR>/files` | Shared folder: projects, merge sources, `fonts/`, `templates/` |
| `GLW_WEB_ROOT` | `/opt/glabels-web/web` | Built web interface |
| `GLW_BATCH_COMMAND` | `/opt/glabels/bin/glabels-batch-qt` | Renderer in the same image |
| `GLW_BATCH_DOCKER_IMAGE` | *(empty)* | Renderer through a separate container (development) |
| `GLW_RENDER_TIMEOUT` | `60` | Maximum render time in seconds |
| `GLW_RENDER_CONCURRENCY` | `2` | Concurrent render jobs |
| `GLW_MAX_UPLOAD_BYTES` | `33554432` | Maximum upload size, also after unpacking gzip |
| `GLW_CORS_ORIGINS` | *(empty)* | Allowed origins, comma separated |
| `GLW_PUBLIC_URL` | *(empty)* | Address people reach this installation at, e.g. `https://labels.home.lan`; used for the QR code of the phone view. Empty: the address the browser is on |

Region and unit are not environment variables but settings in the interface;
they are stored in the database with the rest of the data.

## Access

The application has no users, no login and no permissions: whoever reaches
it can open every project, change the shared folder and print. That is
deliberate — access belongs to the reverse proxy in front of it, which is
where HTTPS, authentication (basic auth, OIDC, an identity-aware proxy) and
IP restrictions live. Bind the container to localhost and let only the proxy
reach it, as the compose file does.

## On a phone

A phone opening the application gets a view made for printing, not for
designing: a list of labels, and per label its text, a preview, the number
of copies and a print button. The printer is always shown; with more than
one it can be chosen, and the phone remembers its choice (falling back to
the default printer if that one disappears). Text
changes are saved as you type and end up in the project, like any other
edit. The preview is the same PDF that gets printed.

- Every label has its own address, `/m/<id>`: bookmark it or add it to the
  home screen to reach one label in one tap. `/m` is the list.
- On the desktop, **Open on phone** in the toolbar shows a QR code for the
  open label (or the list); scan it with the phone's camera. The code holds
  address from `GLW_PUBLIC_URL` when that is set, and otherwise the address
  this browser uses — then open the application through its network address
  rather than `localhost`.
- **Desktop** at the top of the phone view switches that device to the full
  editor and remembers it; *Open on phone ▸ Use the phone view here* switches
  back.
- Added to the home screen, the app opens full screen. On iOS that works over
  plain HTTP; Android only installs it as an app over HTTPS, and otherwise
  adds a normal shortcut.

## Preferences

**Edit ▸ Preferences…** holds two settings of the installation:

| Setting | Meaning |
| --- | --- |
| Region | Interface language and date and time format. By default the application follows the browser; that is not always right, and then you pin it here. |
| Unit | mm, cm, inch, point or pica, for all fields in the editor and product definitions. |

Both belong to the **server**, not to a browser: everyone who opens this
installation sees the same language, format and unit, even on a workstation
whose language setting differs.

The interface is available in English and Dutch. A Dutch region (`nl-NL`,
`nl-BE`) gives Dutch, any other region gives English. Adding a language is one
file: copy `frontend/src/i18n/nl.ts`, translate the texts and add the language
to `CATALOGS` in `frontend/src/i18n/index.tsx`. English (`en.ts`) is the
source catalogue; the `Messages` type makes a missing or stray key fail the
build, so a translation cannot silently fall behind. The translate function
only accepts keys that exist, so a typo in a key fails the build too.

## The shared folder

One folder, mounted into the container as a volume:

| Content | Purpose |
| --- | --- |
| `*.glabels` | Projects; File ▸ Save and Save as… write them here |
| `*.csv`, `*.tsv`, `*.txt` | Merge sources, chosen through Merge ▸ Choose file… |
| `templates/*.xml` | User product definitions |
| `fonts/*.ttf`, `*.otf` | Fonts; usable right away on the canvas and in prints |

Files can also be put on the volume directly; the web interface picks them
up. The application never opens anything outside this folder: every path from
a request is checked against the base folder first, symbolic links included.

A merge source is stored in the document as a bare file name
(`<Merge type="Text/Comma" src="addresses.csv"/>`). That is exactly what
gLabels Qt expects — it looks for the source next to the document file — so
the file stays usable on a desktop. Where the file lives on this server is
application metadata and is kept in SQLite, not in the `.glabels` file.

## Documentation

- [Compatibility with gLabels Qt](docs/compatibility.md)
- [Printers and printing](docs/printers.md)
- [User product definitions](docs/product-definitions.md)

## License

gLabels Web is free software under the GNU General Public License, version 3
or later; see [LICENSE](LICENSE).

It builds on [gLabels Qt](https://github.com/j-evins/glabels-qt): the images
contain its renderer (GPL-3.0-or-later) and its product definitions
(MIT/X), and the interface uses its icons (GPL-3.0-or-later). The origin of
all icons, including a few of our own and one from The Noun Project (CC BY),
is listed in `frontend/public/icons/origin.md`.
