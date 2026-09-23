# syntax=docker/dockerfile:1.7
#
# IPP Everywhere printer simulator for development and tests.
#
# Only meant to walk through the chain add printer -> print -> job state
# without hardware. This image does not belong in production; it accepts jobs
# without any authentication.

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      cups-ipp-utils \
      # ippeveprinter refuses to start without DNS-SD; that needs Avahi.
      avahi-daemon \
      dbus \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/testprinter-entrypoint.sh /usr/local/bin/testprinter
RUN chmod 0755 /usr/local/bin/testprinter

# Jobs end up here as PDF, so you can check what was sent.
VOLUME ["/spool"]
EXPOSE 8632

ENTRYPOINT ["/usr/local/bin/testprinter"]
