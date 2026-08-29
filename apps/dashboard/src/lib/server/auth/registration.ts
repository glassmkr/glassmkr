// Whether this instance accepts NEW accounts.
//
// Self-hosters routinely want to create their own account and then close the
// door, so GLASSMKR_DISABLE_REGISTRATION=1 turns a fresh instance into a
// single-tenant one. Off by default, because the documented first-run flow is
// "bring the stack up, register the first account".
//
// This has to be enforced at every account-CREATING path, not just the
// password form. The OAuth callbacks create an account for any unrecognised
// provider identity, so an instance with GitHub or Google configured would
// still hand an account to anyone who could click "sign in with GitHub".
// Signing IN to an account that already exists stays allowed: this closes
// registration, it does not lock existing users out.
export function registrationDisabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.GLASSMKR_DISABLE_REGISTRATION ?? "");
}

export class RegistrationDisabledError extends Error {
  readonly registrationDisabled = true;
  constructor() {
    super("Registration is disabled on this instance.");
    this.name = "RegistrationDisabledError";
  }
}
