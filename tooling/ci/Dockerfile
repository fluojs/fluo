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
    xvfb fonts-noto-color-emoji fonts-unifont \
    libfontconfig1 libfreetype6 xfonts-scalable \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf \
    libcairo2 libglib2.0-0 libpango-1.0-0 libavcodec59 libcairo-gobject2 \
    libdbus-glib-1-2 libgdk-pixbuf-2.0-0 libharfbuzz0b libpangocairo-1.0-0 \
    libx11-xcb1 libxcb-shm0 libxcursor1 libxi6 libxrender1 libxtst6 \
    libsoup-3.0-0 gstreamer1.0-libav gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
    libegl1 libenchant-2-2 libepoxy0 libevdev2 libgles2 libglx0 \
    libgstreamer-gl1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer1.0-0 \
    libgtk-4-1 libgudev-1.0-0 libharfbuzz-icu0 libhyphen0 libicu72 \
    libjpeg62-turbo liblcms2-2 libmanette-0.2-0 libnotify4 libopengl0 \
    libopenjp2-7 libopus0 libpng16-16 libproxy1v5 libsecret-1-0 \
    libwayland-client0 libwayland-egl1 libwayland-server0 \
    libwebp7 libwebpdemux2 libwoff1 libxml2 libxslt1.1 \
    libatomic1 libevent-2.1-7 libavif15 \
    && rm -rf /var/lib/apt/lists/*

COPY environment.lock.json verification-environment.mjs /opt/verification/
RUN node /opt/verification/verification-environment.mjs install

ENV PATH="/opt/node/24.21.0/bin:/opt/pnpm/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV TZ=UTC LANG=C.UTF-8 CI=1
WORKDIR /workspace
