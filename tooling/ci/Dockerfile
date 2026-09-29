FROM node:24-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4
ARG VERIFICATION_RECIPE_ID
LABEL org.fluo.verification.image-key="${VERIFICATION_RECIPE_ID}"

RUN rm /etc/apt/sources.list.d/debian.sources \
    && printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260928T000000Z bookworm bookworm-updates main\n\
deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20260928T000000Z bookworm-security main\n' \
      > /etc/apt/sources.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip xz-utils \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 \
    libgtk-3-0 libnspr4 libnss3 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    libxshmfence1 libxss1 \
    && rm -rf /var/lib/apt/lists/*

COPY environment.lock.json verification-environment.mjs /opt/verification/
RUN node /opt/verification/verification-environment.mjs install

ENV PATH="/opt/node/24.21.0/bin:/opt/pnpm/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV TZ=UTC LANG=C.UTF-8 CI=1
WORKDIR /workspace
