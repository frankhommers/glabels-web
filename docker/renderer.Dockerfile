# syntax=docker/dockerfile:1.7
#
# Builds the upstream gLabels Qt renderer (glabels-batch-qt) plus the template
# database. The result is a runtime image that makes PDFs headless.
#
# Upstream is GPL-3.0-or-later; templates MIT/X. See README, "Licenses".

ARG DEBIAN_BASE=debian:trixie-slim

# ---------------------------------------------------------------- build stage
FROM ${DEBIAN_BASE} AS build

ARG GLABELS_REPO=https://github.com/j-evins/glabels-qt.git
# Pinned upstream commit; change it only deliberately and document why.
ARG GLABELS_COMMIT=554c9f04389f7a1afa18685cab015273f0b21d94

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      git \
      ninja-build \
      pkg-config \
      qt6-base-dev \
      qt6-base-dev-tools \
      qt6-l10n-tools \
      qt6-svg-dev \
      qt6-tools-dev \
      qt6-tools-dev-tools \
      zlib1g-dev \
      libqrencode-dev \
      libzint-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git init -q . \
 && git remote add origin "${GLABELS_REPO}" \
 && git fetch --depth 1 origin "${GLABELS_COMMIT}" \
 && git checkout -q FETCH_HEAD \
 && git rev-parse HEAD > /src-commit.txt

# The configure output shows which barcode backends were compiled in. That
# list is part of the compatibility matrix: keep it in the image.
RUN cmake -S /src -B /build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/glabels \
      2>&1 | tee /build-config.txt

# Build only the batch renderer: the Qt GUI and the upstream unit tests are not
# needed here and made the build run out of memory on an 8 GB machine. The
# parallelism is limited on purpose; upstream compiles with -g.
ARG BUILD_JOBS=2
RUN cmake --build /build --target glabels-batch-qt --parallel "${BUILD_JOBS}"

# Install by hand, because "cmake --install" also wants the GUI that was not
# built. Templates must sit next to the binary: FileUtil looks for them in
# <prefix>/share/glabels-qt/templates.
RUN set -eux; \
    install -D -m 0755 /build/glabels-batch/glabels-batch-qt /opt/glabels/bin/glabels-batch-qt; \
    strip /opt/glabels/bin/glabels-batch-qt; \
    mkdir -p /opt/glabels/share/glabels-qt/templates; \
    cp /src/templates/*.xml /src/templates/*.dtd /opt/glabels/share/glabels-qt/templates/; \
    # FileUtil::translationsDir() aborts with qFatal if this folder is missing.
    # We do not build the .qm files themselves; the batch renderer runs in English.
    mkdir -p /opt/glabels/share/glabels-qt/translations

# -------------------------------------------------------------- runtime stage
FROM ${DEBIAN_BASE} AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      libqt6core6t64 \
      libqt6gui6 \
      libqt6widgets6 \
      libqt6printsupport6 \
      libqt6svg6 \
      libqt6xml6 \
      libqt6concurrent6 \
      zlib1g \
      libqrencode4 \
      libzint2.15 \
      fonts-dejavu-core \
      fonts-liberation2 \
      fontconfig \
      # For the page preview: the same PDF that goes to the printer, rasterised
      # to an image for display in the browser.
      poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/glabels /opt/glabels
COPY --from=build /build-config.txt /opt/glabels/share/glabels-web/build-config.txt
COPY --from=build /src-commit.txt  /opt/glabels/share/glabels-web/upstream-commit.txt

# Qt without X11/Wayland; batch only renders to a file. HOME/XDG point to /tmp
# so QSettings and the font cache also work when the container runs with an
# arbitrary uid (needed with bind mounts).
ENV QT_QPA_PLATFORM=offscreen \
    PATH=/opt/glabels/bin:$PATH \
    HOME=/tmp \
    XDG_CONFIG_HOME=/tmp/.config \
    XDG_CACHE_HOME=/tmp/.cache

WORKDIR /work
ENTRYPOINT ["glabels-batch-qt"]
