FROM python:3.12-slim-bookworm@sha256:8a7e7cc04fd3e2bd787f7f24e22d5d119aa590d429b50c95dfe12b3abe52f48b
ARG BUILD_VERSION=development
ARG BUILD_ARCH="aarch64|amd64"
ENV APP_VERSION=${BUILD_VERSION}
LABEL io.hass.version="${BUILD_VERSION}" \
      io.hass.type="app" \
      io.hass.arch="${BUILD_ARCH}" \
      io.hass.name="Personal Video Studio" \
      io.hass.description="Private Home Assistant personal video viewer" \
      io.hass.url="https://github.com/resace3/home-assistant-personal-video-addon" \
      org.opencontainers.image.title="Personal Video Studio" \
      org.opencontainers.image.description="Private Home Assistant personal video viewer" \
      org.opencontainers.image.source="https://github.com/resace3/home-assistant-personal-video-addon" \
      org.opencontainers.image.licenses="Apache-2.0"
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends curl gosu && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 10001 studio && \
    useradd --system --uid 10001 --gid studio --home-dir /nonexistent --shell /usr/sbin/nologin studio
WORKDIR /app
COPY requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.lock
COPY app /app
COPY run.sh /run.sh
RUN chmod 0755 /run.sh && chown -R studio:studio /app
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:8099/api/health >/dev/null || exit 1
CMD ["/run.sh"]
