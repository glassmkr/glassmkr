import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: "build" }),
    // SvelteKit's built-in checkOrigin rejects every form-encoded
    // (application/x-www-form-urlencoded, multipart/form-data, text/plain)
    // POST whose Origin header does not match this site. That is correct for
    // browser form actions but wrong for the OAuth 2.1 machine endpoints
    // (/oauth/token, /oauth/revoke, /oauth/register), which MUST accept the
    // cross-origin, form-encoded POSTs the spec requires and are authenticated
    // by client_id + PKCE + a one-time code, not by the session cookie. We turn
    // the blunt global check off here and re-apply the identical origin check
    // for every non-OAuth path in hooks.server.ts (csrfHandle), so browser form
    // actions keep the same protection while the OAuth endpoints work.
    csrf: { checkOrigin: false },
    // Content-Security-Policy (security audit 2026-05-22 §1.6 / catalog
    // T-309). SvelteKit emits this as a <meta http-equiv> and auto-adds a
    // nonce/hash to its own inline hydration scripts (mode: auto = nonce
    // for SSR pages, hash for prerendered). frame-ancestors is NOT settable
    // via meta, so clickjacking protection is an X-Frame-Options HEADER set
    // in hooks.server.ts instead.
    //
    // No external scripts/styles are loaded (confirmed: no polyfill.io, no
    // Google Fonts stylesheet, system fonts only), so default-src 'self'
    // is the floor. connect-src additionally allows Sentry/GlitchTip
    // ingest for the browser SDK (PUBLIC_SENTRY_DSN); add the self-hosted
    // GlitchTip host here when it lands.
    csp: {
      mode: "auto",
      directives: {
        "default-src": ["self"],
        "script-src": ["self"],
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "https:"],
        // data: for the self-hosted Geist fonts, which ship inlined as data URIs.
        "font-src": ["self", "data:"],
        "connect-src": [
          "self",
          "https://*.sentry.io",
          "https://*.ingest.sentry.io",
          "https://*.ingest.de.sentry.io",
          // Self-hosted GlitchTip ingest for the browser Sentry SDK.
          "https://glitchtip.glassmkr.com",
        ],
        "object-src": ["none"],
        "base-uri": ["self"],
        // form-action governs where a form submission (and its redirect targets)
        // may go. The MCP OAuth consent form legitimately redirects to the
        // client's loopback redirect_uri (http://localhost:<port>/callback), so
        // 'self' alone blocked every authorization from completing. Allow the
        // loopback hosts OAuth clients use; every other form still posts to self.
        // localhost, 127.0.0.1, and [::1] are the loopback redirect_uri hosts
        // that oauth/validation.ts accepts for native clients. HTTPS callbacks
        // are also accepted server-side but not allowed here: the correct fix
        // for those is to drive the consent redirect via enhance + a client
        // navigation (not governed by form-action) rather than widen the CSP to
        // https:. Tracked as a follow-up.
        "form-action": ["self", "http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"],
      },
    },
  },
};
