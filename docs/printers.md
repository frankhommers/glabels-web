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
(usually `/ipp/print`). USB printers, raw sockets (`socket://`, ZPL) and
printers attached only to the browser's computer are outside this version.

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
  label then blows an address label up to twice its size. If no size matches,
  the printer chooses, as before.
- The list of printers is ours and lives in SQLite: a name for an IPP
  address, nothing more. State and jobs come straight from the printer.
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
