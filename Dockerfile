ARG BASE_IMAGE=mcr.microsoft.com/playwright:v1.61.1-noble
FROM ${BASE_IMAGE} AS build
WORKDIR /app
COPY vendor/node_modules.tar.gz .
RUN tar xzf node_modules.tar.gz && rm node_modules.tar.gz
COPY package.json tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM ${BASE_IMAGE}
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production \
    HOME=/tmp \
    RUNS_DIR=/app/runs \
    BROWSER_LAUNCH_ARGS="--no-sandbox"
RUN mkdir -p /app/runs && chgrp -R 0 /app && chmod -R g=u /app
EXPOSE 3000
CMD ["node", "dist/index.js"]
