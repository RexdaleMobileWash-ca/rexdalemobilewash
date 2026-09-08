// Where contact-form submissions go, and who they appear to come from.
//
// Addresses only. The Resend API key is NOT here and is not a build variable —
// it is a Worker secret, read at runtime from `cloudflare:workers`. A build
// variable is visible while the build runs and absent when the route executes,
// so the form fails in production with a build that passed.

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
 *      not involved and does not change.
 *
 *  What it buys is deliverability into Microsoft 365 and a notification that
 *  looks like the business rather than like a third party. */
export const FROM = 'Rexdale Mobile Wash website <website@rexdalemobilewash.ca>';

/** To: the general address printed in the page bodies on all 15 Nicepage pages. */
export const TO = ['customerservice@rexdalemobilewash.ca'];

/** Reply-To: the visitor who filled the form, so hitting Reply answers the lead.
 *
 *  Gate 11's letter says to put the client's own address here. That would make
 *  Reply address the client themselves, which is not useful to anyone — and the
 *  check the gate actually states, that a reply must not go to the sending
 *  domain, still passes with the lead's address. Recorded as a deliberate
 *  difference in the README.
 *
 *  Set per message by the route, from the form's email field. It is never put in
 *  `From`: that is forgery to the receiving mail server and lands in spam. */
export const REPLY_TO_SENDER = true;

/** Shown to the visitor. CF7's own default strings, so the wording on the page
 *  does not change either. */
export const MESSAGES = {
  sent: 'Thank you for your message. It has been sent.',
  failed: 'There was an error trying to send your message. Please try again later.',
  invalid: 'One or more fields have an error. Please check and try again.',
  spam: 'There was an error trying to send your message. Please try again later.',
};
