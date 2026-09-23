#!/bin/sh
# Start Avahi (required by ippeveprinter) and then the printer simulator.
set -e

NAME="${PRINTER_NAME:-Testlabelprinter}"
PORT="${PRINTER_PORT:-8632}"
# ippeveprinter checks the Host header of every request against its own host
# name; if they differ it answers "Bad Host". So give the container the name
# clients use to reach it:
#   docker run --hostname printer --name printer ...
# PRINTER_HOSTNAME exists for the rare case where that is not possible; with
# it, ippeveprinter binds to that name only.

mkdir -p /run/dbus /spool
rm -f /run/dbus/pid
dbus-daemon --system --fork
avahi-daemon --no-chroot --daemonize

# -k keeps the job files, so you can check what was printed.
exec ippeveprinter \
    -p "$PORT" \
    ${PRINTER_HOSTNAME:+-n "$PRINTER_HOSTNAME"} \
    -f application/pdf \
    -M "gLabels Web" \
    -m "Testlabelprinter" \
    -l "development" \
    -d /spool \
    -k \
    -v \
    "$NAME"
