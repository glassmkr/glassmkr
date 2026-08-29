# Third-party notices

Glassmkr's production dependency tree, generated from the lockfile by
`scripts/gen-third-party-notices.mjs`; do not edit by hand. Each package's
full license text ships with the package itself (in its node_modules
directory, which the container image retains).

Notes:
- Packages that declare an `os` or `cpu` constraint are omitted, because
  which of them appears depends on the machine that resolved the tree, not
  on what we ship. Their licenses are unaffected and their texts ship with
  the packages if they install.
- `@fontsource/*` packages redistribute fonts under the SIL Open Font
  License 1.1; the OFL texts ship inside those packages and the fonts are
  self-hosted unmodified.
- `caniuse-lite` data is CC-BY-4.0; attribution: caniuse.com.
- `@sentry/cli` (FSL-1.1-MIT) is build-time tooling only; it is not part
  of the distributed application. The runtime `@sentry/*` SDK packages are
  MIT and are inert unless an operator configures a DSN.

## License summary

- MIT: 271
- Apache-2.0: 37
- ISC: 18
- BSD-3-Clause: 7
- BlueOak-1.0.0: 5
- BSD-2-Clause: 4
- OFL-1.1: 3
- MIT OR Apache-2.0: 1
- FSL-1.1-MIT: 1
- CC-BY-4.0: 1
- Unlicense: 1
- MIT-0: 1
- (MIT OR CC0-1.0): 1

## Packages

| Package | Version(s) | License |
|---|---|---|
| @babel/code-frame | 7.29.0 | MIT |
| @babel/compat-data | 7.29.3 | MIT |
| @babel/core | 7.29.0 | MIT |
| @babel/generator | 7.29.1 | MIT |
| @babel/helper-compilation-targets | 7.28.6 | MIT |
| @babel/helper-globals | 7.28.0 | MIT |
| @babel/helper-module-imports | 7.28.6 | MIT |
| @babel/helper-module-transforms | 7.28.6 | MIT |
| @babel/helper-string-parser | 7.27.1 | MIT |
| @babel/helper-validator-identifier | 7.28.5 | MIT |
| @babel/helper-validator-option | 7.27.1 | MIT |
| @babel/helpers | 7.29.2 | MIT |
| @babel/parser | 7.29.3 | MIT |
| @babel/template | 7.28.6 | MIT |
| @babel/traverse | 7.29.0 | MIT |
| @babel/types | 7.29.0 | MIT |
| @clickhouse/client | 1.18.2 | Apache-2.0 |
| @clickhouse/client-common | 1.18.2 | Apache-2.0 |
| @cloudflare/workers-types | 4.20260702.1 | MIT OR Apache-2.0 |
| @fastify/otel | 0.18.0 | MIT |
| @fontsource/commit-mono | 5.3.0 | OFL-1.1 |
| @fontsource/ibm-plex-sans | 5.3.0 | OFL-1.1 |
| @fontsource/source-serif-4 | 5.3.0 | OFL-1.1 |
| @hono/node-server | 1.19.14 | MIT |
| @ioredis/commands | 1.5.1 | MIT |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.5.5 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @modelcontextprotocol/sdk | 1.29.0 | MIT |
| @opentelemetry/api | 1.9.1 | Apache-2.0 |
| @opentelemetry/api-logs | 0.207.0, 0.212.0, 0.214.0 | Apache-2.0 |
| @opentelemetry/core | 2.6.1, 2.7.1 | Apache-2.0 |
| @opentelemetry/instrumentation | 0.207.0, 0.212.0, 0.214.0 | Apache-2.0 |
| @opentelemetry/instrumentation-amqplib | 0.61.0 | Apache-2.0 |
| @opentelemetry/instrumentation-connect | 0.57.0 | Apache-2.0 |
| @opentelemetry/instrumentation-dataloader | 0.31.0 | Apache-2.0 |
| @opentelemetry/instrumentation-fs | 0.33.0 | Apache-2.0 |
| @opentelemetry/instrumentation-generic-pool | 0.57.0 | Apache-2.0 |
| @opentelemetry/instrumentation-graphql | 0.62.0 | Apache-2.0 |
| @opentelemetry/instrumentation-hapi | 0.60.0 | Apache-2.0 |
| @opentelemetry/instrumentation-http | 0.214.0 | Apache-2.0 |
| @opentelemetry/instrumentation-kafkajs | 0.23.0 | Apache-2.0 |
| @opentelemetry/instrumentation-knex | 0.58.0 | Apache-2.0 |
| @opentelemetry/instrumentation-koa | 0.62.0 | Apache-2.0 |
| @opentelemetry/instrumentation-lru-memoizer | 0.58.0 | Apache-2.0 |
| @opentelemetry/instrumentation-mongodb | 0.67.0 | Apache-2.0 |
| @opentelemetry/instrumentation-mongoose | 0.60.0 | Apache-2.0 |
| @opentelemetry/instrumentation-mysql | 0.60.0 | Apache-2.0 |
| @opentelemetry/instrumentation-mysql2 | 0.60.0 | Apache-2.0 |
| @opentelemetry/instrumentation-pg | 0.66.0 | Apache-2.0 |
| @opentelemetry/instrumentation-tedious | 0.33.0 | Apache-2.0 |
| @opentelemetry/resources | 2.7.1 | Apache-2.0 |
| @opentelemetry/sdk-trace-base | 2.7.1 | Apache-2.0 |
| @opentelemetry/semantic-conventions | 1.41.1 | Apache-2.0 |
| @opentelemetry/sql-common | 0.41.2 | Apache-2.0 |
| @polka/url | 1.0.0-next.29 | MIT |
| @prisma/instrumentation | 7.6.0 | Apache-2.0 |
| @rollup/plugin-commonjs | 29.0.2 | MIT |
| @rollup/plugin-json | 6.1.0 | MIT |
| @rollup/plugin-node-resolve | 16.0.3 | MIT |
| @rollup/pluginutils | 5.3.0 | MIT |
| @sentry-internal/browser-utils | 10.53.1 | MIT |
| @sentry-internal/feedback | 10.53.1 | MIT |
| @sentry-internal/replay | 10.53.1 | MIT |
| @sentry-internal/replay-canvas | 10.53.1 | MIT |
| @sentry/babel-plugin-component-annotate | 5.3.0 | MIT |
| @sentry/browser | 10.53.1 | MIT |
| @sentry/bundler-plugin-core | 5.3.0 | MIT |
| @sentry/cli | 2.58.5 | FSL-1.1-MIT |
| @sentry/cloudflare | 10.53.1 | MIT |
| @sentry/core | 10.53.1 | MIT |
| @sentry/node | 10.53.1 | MIT |
| @sentry/node-core | 10.53.1 | MIT |
| @sentry/opentelemetry | 10.53.1 | MIT |
| @sentry/rollup-plugin | 5.3.0 | MIT |
| @sentry/svelte | 10.53.1 | MIT |
| @sentry/sveltekit | 10.53.1 | MIT |
| @sentry/vite-plugin | 5.3.0 | MIT |
| @stablelib/base64 | 1.0.1 | MIT |
| @standard-schema/spec | 1.1.0 | MIT |
| @sveltejs/acorn-typescript | 1.0.9, 1.0.10 | MIT |
| @sveltejs/adapter-node | 5.5.4 | MIT |
| @sveltejs/kit | 2.61.1 | MIT |
| @sveltejs/vite-plugin-svelte | 5.1.1 | MIT |
| @sveltejs/vite-plugin-svelte-inspector | 4.0.1 | MIT |
| @types/connect | 3.4.38 | MIT |
| @types/cookie | 0.6.0 | MIT |
| @types/estree | 1.0.8 | MIT |
| @types/mysql | 2.15.27 | MIT |
| @types/node | 25.5.2 | MIT |
| @types/pg | 8.15.6, 8.20.0 | MIT |
| @types/pg-pool | 2.0.7 | MIT |
| @types/resolve | 1.20.2 | MIT |
| @types/tedious | 4.0.14 | MIT |
| @types/trusted-types | 2.0.7 | MIT |
| @typescript-eslint/types | 8.58.1 | MIT |
| accepts | 2.0.0 | MIT |
| acorn | 8.16.0 | MIT |
| acorn-import-attributes | 1.9.5 | MIT |
| adm-zip | 0.5.17 | MIT |
| agent-base | 6.0.2 | MIT |
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| argparse | 1.0.10 | MIT |
| aria-query | 5.3.1 | Apache-2.0 |
| axobject-query | 4.1.0 | Apache-2.0 |
| balanced-match | 4.0.4 | MIT |
| baseline-browser-mapping | 2.10.29 | Apache-2.0 |
| bcrypt | 6.0.0 | MIT |
| body-parser | 2.3.0 | MIT |
| boolean | 3.2.0 | MIT |
| brace-expansion | 5.0.6 | MIT |
| browserslist | 4.28.2 | MIT |
| buffer-equal-constant-time | 1.0.1 | BSD-3-Clause |
| bytes | 3.1.2 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| caniuse-lite | 1.0.30001792 | CC-BY-4.0 |
| cjs-module-lexer | 2.2.0 | MIT |
| clsx | 2.1.1 | MIT |
| cluster-key-slot | 1.1.2 | Apache-2.0 |
| commondir | 1.0.1 | MIT |
| content-disposition | 1.1.0 | MIT |
| content-type | 1.0.5, 2.0.0 | MIT |
| convert-source-map | 2.0.0 | MIT |
| cookie | 0.7.2, 1.1.1 | MIT |
| cookie-signature | 1.2.2 | MIT |
| cors | 2.8.6 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 4.4.3 | MIT |
| deepmerge | 4.3.1 | MIT |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| depd | 2.0.0 | MIT |
| detect-node | 2.1.0 | MIT |
| devalue | 5.8.1 | MIT |
| dotenv | 16.6.1 | BSD-2-Clause |
| dunder-proto | 1.0.1 | MIT |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 |
| ee-first | 1.1.1 | MIT |
| electron-to-chromium | 1.5.355 | ISC |
| encodeurl | 2.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| es6-error | 4.1.1 | MIT |
| esbuild | 0.25.12 | MIT |
| escalade | 3.2.0 | MIT |
| escape-html | 1.0.3 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| esm-env | 1.2.2 | MIT |
| esprima | 4.0.1 | BSD-2-Clause |
| esrap | 2.2.9 | MIT |
| estree-walker | 2.0.2 | MIT |
| etag | 1.8.1 | MIT |
| eventsource | 3.0.7 | MIT |
| eventsource-parser | 3.1.0 | MIT |
| express | 5.2.1 | MIT |
| express-rate-limit | 8.6.0 | MIT |
| extend-shallow | 2.0.1 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-sha256 | 1.3.0 | Unlicense |
| fast-uri | 3.1.3 | BSD-3-Clause |
| fdir | 6.5.0 | MIT |
| finalhandler | 2.1.1 | MIT |
| find-up | 5.0.0 | MIT |
| flatpickr | 4.6.13 | MIT |
| forwarded | 0.2.0 | MIT |
| forwarded-parse | 2.1.2 | MIT |
| fresh | 2.0.0 | MIT |
| function-bind | 1.1.2 | MIT |
| gensync | 1.0.0-beta.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| glob | 13.0.6 | BlueOak-1.0.0 |
| global-agent | 3.0.0 | BSD-3-Clause |
| globalthis | 1.0.4 | MIT |
| globalyzer | 0.1.0 | MIT |
| globrex | 0.1.2 | MIT |
| gopd | 1.2.0 | MIT |
| gray-matter | 4.0.3 | MIT |
| has-property-descriptors | 1.0.2 | MIT |
| has-symbols | 1.1.0 | MIT |
| hasown | 2.0.2 | MIT |
| hono | 4.12.30 | MIT |
| http-errors | 2.0.1 | MIT |
| https-proxy-agent | 5.0.1 | MIT |
| iconv-lite | 0.7.3 | MIT |
| import-in-the-middle | 2.0.6, 3.0.1 | Apache-2.0 |
| inherits | 2.0.4 | ISC |
| ioredis | 5.10.1 | MIT |
| ip-address | 10.2.0 | MIT |
| ipaddr.js | 1.9.1 | MIT |
| is-core-module | 2.16.1 | MIT |
| is-extendable | 0.1.1 | MIT |
| is-module | 1.0.0 | MIT |
| is-promise | 4.0.0 | MIT |
| is-reference | 1.2.1, 3.0.3 | MIT |
| isexe | 2.0.0 | ISC |
| jose | 5.10.0, 6.2.3 | MIT |
| js-tokens | 4.0.0 | MIT |
| js-yaml | 3.14.2 | MIT |
| jsesc | 3.1.0 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| json-schema-typed | 8.0.2 | BSD-2-Clause |
| json-stringify-safe | 5.0.1 | ISC |
| json5 | 2.2.3 | MIT |
| jsonwebtoken | 9.0.3 | MIT |
| jwa | 2.0.1 | MIT |
| jws | 4.0.1 | MIT |
| kind-of | 6.0.3 | MIT |
| kleur | 4.1.5 | MIT |
| locate-character | 3.0.0 | MIT |
| locate-path | 6.0.0 | MIT |
| lodash.defaults | 4.2.0 | MIT |
| lodash.includes | 4.3.0 | MIT |
| lodash.isarguments | 3.1.0 | MIT |
| lodash.isboolean | 3.0.3 | MIT |
| lodash.isinteger | 4.0.4 | MIT |
| lodash.isnumber | 3.0.3 | MIT |
| lodash.isplainobject | 4.0.6 | MIT |
| lodash.isstring | 4.0.1 | MIT |
| lodash.once | 4.1.1 | MIT |
| lru-cache | 5.1.1 | ISC |
| lru-cache | 11.3.6 | BlueOak-1.0.0 |
| lucide-svelte | 0.469.0 | ISC |
| magic-string | 0.30.21 | MIT |
| matcher | 3.0.0 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| media-typer | 1.1.0 | MIT |
| merge-descriptors | 2.0.0 | MIT |
| mime-db | 1.54.0 | MIT |
| mime-types | 3.0.2 | MIT |
| minimatch | 10.2.5 | BlueOak-1.0.0 |
| minimist | 1.2.8 | MIT |
| minipass | 7.1.3 | BlueOak-1.0.0 |
| module-details-from-path | 1.0.4 | MIT |
| mrmime | 2.0.1 | MIT |
| ms | 2.1.3 | MIT |
| nanoid | 3.3.12 | MIT |
| negotiator | 1.0.0 | MIT |
| node-addon-api | 8.7.0 | MIT |
| node-cron | 4.2.1 | ISC |
| node-fetch | 2.7.0 | MIT |
| node-gyp-build | 4.8.4 | MIT |
| node-releases | 2.0.44 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| object-keys | 1.1.1 | MIT |
| on-finished | 2.4.1 | MIT |
| once | 1.4.0 | ISC |
| onnxruntime-common | 1.24.3 | MIT |
| p-limit | 3.1.0 | MIT |
| p-locate | 5.0.0 | MIT |
| parseurl | 1.3.3 | MIT |
| path-exists | 4.0.0 | MIT |
| path-key | 3.1.1 | MIT |
| path-parse | 1.0.7 | MIT |
| path-scurry | 2.0.2 | BlueOak-1.0.0 |
| path-to-regexp | 8.4.2 | MIT |
| pg | 8.20.0 | MIT |
| pg-cloudflare | 1.3.0 | MIT |
| pg-connection-string | 2.12.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.13.0 | MIT |
| pg-protocol | 1.13.0 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.4 | MIT |
| pkce-challenge | 5.0.1 | MIT |
| postal-mime | 2.7.4 | MIT-0 |
| postcss | 8.5.15 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| progress | 2.0.3 | MIT |
| proxy-addr | 2.0.7 | MIT |
| proxy-from-env | 1.1.0 | MIT |
| qs | 6.15.3 | BSD-3-Clause |
| range-parser | 1.3.0 | MIT |
| raw-body | 3.0.2 | MIT |
| redis-errors | 1.2.0 | MIT |
| redis-parser | 3.0.0 | MIT |
| require-from-string | 2.0.2 | MIT |
| require-in-the-middle | 8.0.1 | MIT |
| resend | 6.10.0 | MIT |
| resolve | 1.22.11 | MIT |
| roarr | 2.15.4 | BSD-3-Clause |
| rollup | 4.60.1 | MIT |
| router | 2.2.0 | MIT |
| safe-buffer | 5.2.1 | MIT |
| safer-buffer | 2.1.2 | MIT |
| section-matter | 1.0.0 | MIT |
| semver | 6.3.1, 7.7.4 | ISC |
| semver-compare | 1.0.0 | MIT |
| send | 1.2.1 | MIT |
| serialize-error | 7.0.1 | MIT |
| serve-static | 2.2.1 | MIT |
| set-cookie-parser | 3.1.0 | MIT |
| setprototypeof | 1.2.0 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| sirv | 3.0.2 | MIT |
| sorcery | 1.0.0 | MIT |
| source-map-js | 1.2.1 | BSD-3-Clause |
| split2 | 4.2.0 | ISC |
| sprintf-js | 1.0.3, 1.1.3 | BSD-3-Clause |
| standard-as-callback | 2.1.0 | MIT |
| standardwebhooks | 1.0.0 | MIT |
| statuses | 2.0.2 | MIT |
| strip-bom-string | 1.0.0 | MIT |
| stripe | 21.0.1 | MIT |
| supports-preserve-symlinks-flag | 1.0.0 | MIT |
| svelte | 5.55.9 | MIT |
| svix | 1.88.0 | MIT |
| tiny-glob | 0.2.9 | MIT |
| tinyglobby | 0.2.16 | MIT |
| toidentifier | 1.0.1 | MIT |
| totalist | 3.0.1 | MIT |
| tr46 | 0.0.3 | MIT |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) |
| type-is | 2.1.0 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| undici-types | 7.18.2 | MIT |
| unpipe | 1.0.0 | MIT |
| update-browserslist-db | 1.2.3 | MIT |
| uplot | 1.6.32 | MIT |
| uuid | 11.1.1 | MIT |
| vary | 1.1.2 | MIT |
| vite | 6.4.2 | MIT |
| vitefu | 1.1.3 | MIT |
| webidl-conversions | 3.0.1 | BSD-2-Clause |
| whatwg-url | 5.0.0 | MIT |
| which | 2.0.2 | ISC |
| wrappy | 1.0.2 | ISC |
| xtend | 4.0.2 | MIT |
| yallist | 3.1.1 | ISC |
| yaml | 2.9.0 | ISC |
| yocto-queue | 0.1.0 | MIT |
| zimmerframe | 1.1.4 | MIT |
| zod | 3.25.76 | MIT |
| zod-to-json-schema | 3.25.2 | ISC |
