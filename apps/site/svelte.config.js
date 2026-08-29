import adapter from "@sveltejs/adapter-node";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    // Content-Security-Policy (security audit 2026-05-22 §1.6 / catalog
    // T-309). Marketing site: no external scripts/styles, no Sentry, no
    // polyfill.io, system fonts only -> strict default-src 'self'.
    // SvelteKit emits this as a <meta> tag with hashed inline scripts
    // (mode: auto -> hash for the prerendered marketing pages).
    // frame-ancestors is header-only (X-Frame-Options in hooks.server.ts).
    csp: {
      mode: "auto",
      directives: {
        "default-src": ["self"],
        "script-src": ["self"],
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "https:"],
        "font-src": ["self"],
        "connect-src": ["self"],
        "object-src": ["none"],
        "base-uri": ["self"],
        "form-action": ["self"],
      },
    },
  },
};

export default config;
