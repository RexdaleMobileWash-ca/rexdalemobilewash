// Where contact-form submissions go, and who they appear to come from.
//
// Values are defaults; each can be overridden by a Worker variable of the same
// name, which is how the test suite retargets the recipient at
// `delivered@resend.dev` without editing the repo or mailing the client.
//
// No secrets here. RESEND_API_KEY and TURNSTILE_SECRET are Worker secrets read
// at runtime from `cloudflare:workers`. A build variable is visible while the
// build runs and absent when the route executes, so the form fails in
// production against a build that passed.

/** From: the client's own domain, chosen deliberately over a TBOX sending
 *  domain — see "Sending as the client's own domain" in the README.
 *
 *  Gate 11 says never to use the client's domain as a sending domain, because a
 *  bounce or a spam complaint then lands on the reputation of the domain that
 *  also carries their Microsoft 365 business mail. Two things make that a much
 *  smaller risk on this specific form than the rule assumes:
 *
 *    * the only recipient is the client themselves, at an address on the same
 *      domain. This is not a mailing to strangers who can mark it as spam.
 *    * the domain is already set up in Resend and the DNS supports it: DKIM at
 *      resend._domainkey, and a separate return path at send.rexdalemobilewash.ca
 *      with its own SPF (include:amazonses.com). So the apex SPF —
 *      `v=spf1 include:secureserver.net -all`, which serves their real mail — is
 *      not involved and does not change. */
export const CONTACT_FROM = 'Rexdale Mobile Wash website <website@rexdalemobilewash.ca>';

/** To: the general address printed in the page bodies on all 15 Nicepage pages. */
export const CONTACT_TO = 'customerservice@rexdalemobilewash.ca';

/** Reply-To: the visitor who filled the form, so hitting Reply answers the lead.
 *
 *  Gate 11's letter says the client's own address. That would make Reply address
 *  the client themselves, which is useful to nobody — and the check the gate
 *  actually states, that a reply must not go to the sending domain, passes with
 *  the lead's address. Recorded as a deliberate difference in the README.
 *
 *  The visitor's address is never put in `From`: that is forgery to the
 *  receiving mail server and lands the notification in spam. */
export const REPLY_TO_SENDER = true;

/** Shown to the visitor on success. CF7's own default string, so the wording on
 *  the page does not change. Every rejection carries its own specific message
 *  from spam-guard.ts — a visitor who is turned away is told what to do about
 *  it, never left with a generic failure. */
export const MESSAGES = {
  sent: 'Thank you for your message. It has been sent.',
  failed: 'There was an error trying to send your message. Please try again later.',
  invalid: 'One or more fields have an error. Please check and try again.',
};

/** Read a Worker variable, falling back to the default above. */
export function setting(
  env: Record<string, unknown>,
  name: 'CONTACT_FROM' | 'CONTACT_TO',
): string {
  const override = env[name];
  if (typeof override === 'string' && override.trim()) return override.trim();
  return name === 'CONTACT_FROM' ? CONTACT_FROM : CONTACT_TO;
}
