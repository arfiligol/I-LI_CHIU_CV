# CI generates and verifies dist, including PDFs, before packaging it.
# Pin the multi-platform index so rebuilding cannot silently change nginx.
FROM nginx:1.30.5-alpine@sha256:ef8676b33d681f272ba429b27658bdd7e640963279714c96bddf1dc76307f7b6

COPY dist/ /usr/share/nginx/html/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
