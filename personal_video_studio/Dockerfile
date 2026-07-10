ARG BUILD_FROM
FROM ${BUILD_FROM}
RUN apk add --no-cache su-exec && addgroup -S -g 10001 studio && adduser -S -D -H -u 10001 -G studio studio
WORKDIR /app
COPY requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.lock
COPY app /app
COPY run.sh /run.sh
RUN chmod 0755 /run.sh && chown -R studio:studio /app
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O - http://127.0.0.1:8099/api/health >/dev/null || exit 1
CMD ["/run.sh"]
