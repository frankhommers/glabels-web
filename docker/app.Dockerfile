# syntax=docker/dockerfile:1.7
#
# Application image: web assets + API on top of the renderer image.
# Build docker/renderer.Dockerfile first; that image provides glabels-batch-qt,
# the template database and the fonts the PDFs are made with.

ARG RENDERER_IMAGE=glabels-web/renderer:dev

# ------------------------------------------------------------ frontend build
FROM node:24-trixie-slim AS web
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ------------------------------------------------------------------- runtime
FROM ${RENDERER_IMAGE} AS runtime

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-venv \
      libxml2 \
      libxslt1.1 \
      # ipptool: the IPP client we use to talk to printers directly. This is
      # just a tool; no print service runs in this image.
      cups-ipp-utils \
    && rm -rf /var/lib/apt/lists/*

# The API runs as an unprivileged user; only the data folder is writable.
RUN useradd --system --create-home --home-dir /home/glabels --uid 10001 glabels \
 && mkdir -p /var/lib/glabels-web/files/fonts /opt/glabels-web \
 && chown -R glabels:glabels /var/lib/glabels-web /opt/glabels-web

# Fonts added by users must be found by the renderer too.
RUN printf '%s\n' \
      '<?xml version="1.0"?>' \
      '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">' \
      '<fontconfig>' \
      '  <dir>/var/lib/glabels-web/files/fonts</dir>' \
      '</fontconfig>' \
      > /etc/fonts/conf.d/99-glabels-web.conf

COPY --chown=glabels:glabels backend/pyproject.toml /opt/glabels-web/backend/
COPY --chown=glabels:glabels backend/glabels_web /opt/glabels-web/backend/glabels_web
COPY --from=web --chown=glabels:glabels /app/dist /opt/glabels-web/web

RUN python3 -m venv /opt/glabels-web/venv \
 && /opt/glabels-web/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/glabels-web/venv/bin/pip install --no-cache-dir /opt/glabels-web/backend \
 && chown -R glabels:glabels /opt/glabels-web/venv

USER glabels
ENV HOME=/home/glabels \
    XDG_CONFIG_HOME=/home/glabels/.config \
    XDG_CACHE_HOME=/home/glabels/.cache \
    QT_QPA_PLATFORM=offscreen \
    GLW_SYSTEM_TEMPLATES_DIR=/opt/glabels/share/glabels-qt/templates \
    GLW_DATA_DIR=/var/lib/glabels-web \
    GLW_FILES_DIR=/var/lib/glabels-web/files \
    GLW_BATCH_COMMAND=/opt/glabels/bin/glabels-batch-qt \
    PATH=/opt/glabels-web/venv/bin:/opt/glabels/bin:$PATH

WORKDIR /opt/glabels-web
VOLUME ["/var/lib/glabels-web"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status==200 else 1)"

ENTRYPOINT ["uvicorn", "glabels_web.main:app", "--host", "0.0.0.0", "--port", "8000"]
