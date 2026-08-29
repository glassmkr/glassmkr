declare global {
  namespace App {
    interface Locals {
      authorized: boolean;
      // Email from the verified Cloudflare Access JWT. Null when the
      // request was authorised via the dev bypass (local dev) or the dev
      // bearer secret rather than a CF Access session.
      email: string | null;
    }
  }
}
export {};
