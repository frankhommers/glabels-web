# Printers and printing

## How to add a printer

1. Go to **Print** and click **Manage printers…**
2. Click **Add printer…** and enter the printer's IPP address, for example
   `ipp://192.168.1.50/ipp/print`. That address is usually in the printer's
   network menu or on its status page. For a printer shared by CUPS it looks
   like `ipp://host:631/printers/Queue_Name`.
3. Click **Test connection**. The printer is queried directly and reports its
   model, state, supported document formats and media sizes. Only when that
   works can the printer be added.
4. Give the printer a name and click **Add**. The first printer becomes the
   default straight away.

Only `ipp://` and `ipps://` are accepted, and the address must have a path
(usually `/ipp/print`). USB printers and raw sockets (`socket://`, ZPL) are
outside this version; a printer attached to your phone or computer is added
as below.

## Printers attached to this device

A label printer next to your phone, on Bluetooth, is not reachable from the
server. Such a printer belongs to the device: it is kept in that browser and
only shows up there, next to the network printers.

- **Desktop:** in **Manage printers…**, click **Add: Bluetooth (NIIMBOT)**.
- **Phone:** on a label, below the printer, tap **+ Add: Bluetooth
  (NIIMBOT)** (shown as long as the phone has no such printer).

The browser shows its own list of devices; choose the printer. Printing then
goes like any other printer: the server makes the same pages as for a network
printer, at the printer's resolution, and the browser sends them. Browsers
let a page reach a Bluetooth device only after a click, and most forget the
choice when the page is reloaded; then the list of devices shows again at the
first print.

This needs Web Bluetooth: Chrome or Edge on Android, Windows, macOS, Linux
or ChromeOS. Safari, Firefox and every browser on an iPhone lack it; there
the button does not show. The site must be opened over HTTPS (or as
`localhost`).

A print to such a printer does not appear in the job history: there is no
server job to follow. Rows of a label's list are marked printed once the
printer has finished.

### Drivers are plugins

What a printer of this device is, and how to talk to it, is up to a driver
in `frontend/src/printing/<driver>/`, registered with one line in
`frontend/src/printing/plugins.ts`. The rest of the application knows them
only through `frontend/src/printing/devices.ts`: a driver finds a printer,
says which label sizes fit it, and prints the pages it gets as pictures.
Removing the line and the folder removes that kind of printer; the printers
added for it stay in the browser and return with the driver.

### NIIMBOT

`frontend/src/printing/niimbot/` drives NIIMBOT label printers (D11, D110,
B1, B21 and others) with [niimbluelib](https://github.com/MultiMote/niimbluelib)
(MIT), the library behind [niim.blue](https://niim.blue). Its code loads only
when a NIIMBOT printer is added or used.

- A label fits when it is at most 4 mm wider than the print head (the head
  prints its middle, as on NIIMBOT's 12.5 mm labels for a 12 mm head) and at
  most 250 mm long. Tape is "may not fit": these printers feed labels with
  gaps.
- The page is printed upright: its top comes out first. The NIIMBOT label
  rolls among the products have their tail at the bottom, so it comes out
  last.
- Grey becomes black or white at half; the print density is the model's
  default.

## What happens under the hood

There is **no print service** in the container. The backend sends the PDF
itself as an IPP `Print-Job` and afterwards asks for the state with
`Get-Job-Attributes`. The requests live as `.test` files in
`backend/glabels_web/printing/ipp/` and are run with `ipptool`.

- Exactly the same PDF as in the print preview is printed, made by
  `glabels-batch-qt` for that revision and those settings.
- The printer's media size that matches the PDF page (within 1.5 mm, in either
  orientation) is sent along as `media`. Without it the print server prints on
  its default size and scales the page to it; a DYMO defaulting to a shipping
  label then blows an address label up to twice its size. A printer can also
  report a range it takes any size within (`custom_min_…` / `custom_max_…`,
  or `roll_min_…` / `roll_max_…`): a tape printer reports its tapes that way.
  A page inside such a range is sent as a size of its own
  (`custom_9.17x67.38mm_9.17x67.38mm`). If nothing matches, the printer
  chooses, as before.
- The list of printers is ours and lives in SQLite: a name for an IPP
  address, the media sizes it reported last, and what it takes. State and
  jobs come straight from the printer.

## Which printers a label fits

The same match tells which printers a label fits. The Print page and the
phone judge every printer by the page that gets printed. This works for any
IPP printer, because it only uses the standard PWG media names.

- **fits**: the printer has this size. For a label on a continuous roll
  (tape), a medium as wide and at least as long counts too (a tape printer
  reports `custom_9.03x1411.11mm_…` for its 9 mm tape), as does a
  `roll_min_…`/`roll_max_…` range.
- **may not fit**: it only fits a `custom_min_…`/`custom_max_…` range. Many
  drivers accept nearly any size that way, also on a label printer that has
  no tape at all (the DYMO LabelWriter 450 DUO's label side takes
  3.53 × 3.53 mm up to 56.9 × 2709 mm), so this is a hint, not a match.
- **does not fit**: nothing matches.
- **unknown**: the printer never reported its sizes.

What you see:

- Printers the label fits come first, then the ones it may fit, then the
  rest, marked "does not fit", with the reason under the list. Printing to
  a printer the label does not fit asks first: it may come out scaled or
  cut off.
- The printer preselected is the one chosen for this label before, unless
  the label does not fit it; else the one chosen last or the default, if
  the label fits it; else the first printer it fits. The choice is kept per
  browser or phone.
- The sizes are remembered from the last time the printer was asked (when
  adding it, and whenever the Print page asks for the state). A printer
  never heard from is asked once, when a label is judged by it.
- When a printer reports nonsense, set by hand what it takes, under
  Manage printers…: *what it reports* (the default), *tape and rolls only*,
  *labels and sheets only*, or *everything*.
- There is no queue that holds jobs and nothing is converted. A printer that
  does not accept PDF is therefore refused when adding it, rather than a print
  coming out differently later.

### Why no CUPS

The original design had CUPS in the application image. That brought filters
for printers without PDF support and a queue, but cost a second daemon in the
container, starting as root to launch that daemon, and about a hundred
megabytes of packages. For IPP Everywhere printers that accept PDF — the
audience of this application — `Print-Job` over IPP is enough. The image runs
as a single unprivileged process again.

## Duplicate prints

Every print action gets its own request id. If the same request arrives again
— after a retry, a slow connection or a double click — the existing job is
returned instead of printing again. The interface says so.

Note: *accepted by the printer* is not the same as *physically printed*.
Follow the job state; it is shown under the print button and fetched live
from the printer.

## Job history

- The list shows the 10 newest jobs, with **Show more** for older ones.
- While a job is pending or processing, the page asks for its state every two
  seconds, and only while the tab is visible. Once everything is done, it
  stops.
- A job's final state (completed, canceled, aborted) is recorded and not asked
  from the printer again. A printer that does not answer is tried once per
  listing, not once per job.
- The history keeps the newest 100 jobs and nothing older than 30 days.
  **Clean up** removes finished jobs; jobs that may still be running stay,
  unless they are older than an hour.

## Testing without hardware

An IPP Everywhere simulator is included:

```bash
docker compose --profile test up -d testprinter
```

Then add it as `ipp://testprinter:8632/ipp/print`. The simulator keeps the
jobs it receives as PDF in `/spool`, so you can check exactly what was sent:

```bash
docker compose exec testprinter ls -la /spool
```

Two quirks of the simulator that say nothing about real printers:

- It refuses requests whose `Host` header does not equal its own host name.
  So give the container the same name you reach it by (Compose takes care of
  that).
- It does not start without DNS-SD; that is why Avahi runs in that image. The
  application image does not need it.

## Docker Desktop on macOS

Containers under Docker Desktop reach the LAN through a process on the Mac.
Since macOS 15 that process needs the **Local Network** permission (System
Settings ▸ Privacy & Security ▸ Local Network ▸ Docker). Without it, a
connection to a printer on the LAN fails with `Host is down` or `Connection
refused`, while the Mac itself reaches the printer fine. After granting the
permission, quit Docker Desktop completely and start it again; the running
process keeps the old permission. On Linux this does not apply.

## What has not been shown yet

- Printing on real hardware: measuring sizes, checking position and scanning
  a barcode. The chain *add → choose → print → state → remove* is shown
  against the simulator; a DYMO LabelWriter 450 has been used but not
  measured.
- Automatic printer discovery through mDNS/Bonjour. The address has to be
  entered by hand for now.
- Printers that do not accept PDF. That would need a conversion step; there
  deliberately is none.
- Resending when a printer is temporarily offline. Without a queue the job
  fails right away, with a message.
- Printer calibration and position offsets. They belong to the printer
  setup, not to the label file, and do not exist yet.
