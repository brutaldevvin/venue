# The console imports @venue/core and @venue/cleanverse as raw TypeScript, so the build needs
# the whole pnpm workspace rather than just apps/console. Next's standalone output then traces
# only the files actually imported, which keeps the runtime image small without a second
# install.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /app

# Manifests first, so a dependency install is only redone when a manifest changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/cleanverse/package.json packages/cleanverse/
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
RUN pnpm --filter @venue/console build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Standalone emits a self-contained server plus the node_modules it actually traced. Static
# assets and public/ are not traced and have to be copied alongside it.
COPY --from=build /app/apps/console/.next/standalone ./
COPY --from=build /app/apps/console/.next/static ./apps/console/.next/static
COPY --from=build /app/apps/console/public ./apps/console/public

# The demo book is seeded from wallets derived in code, so no gitignored key file is needed
# at runtime. Everything else arrives through the environment.
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/console/server.js"]
