// Where contact-form submissions go, and who they appear to come from.
//
// Addresses only. The Resend API key is NOT here and is not a build variable —
// it is a Worker secret, read at runtime from locals.runtime.env. A build
// variable is visible while the build runs and absent when the route executes,
// so the form fails in production with a build that passed.

/** From: a TBOX sending domain, never the client's.
 *
 *  This is what makes it impossible for the form to damage the client's mail
 *  reputation: nothing here sends as rexdalemobilewash.ca, so nothing here can
 *  affect how that domain's mail is treated. A bounce, a spam complaint or a
 *  misconfiguration lands on the sending domain, not on the client. */
export const FROM = 'Rexdale Mobile Wash website <website@digital.brandingcentres.com>';

/** To: the address the site itself labels as its website-inquiry address —
 *  the header and footer both link `dispatch@` with the subject "Website
 *  Inquiry" / "From Rexdale Website", while `customerservice@` is the general
 *  address printed in page bodies. CONFIRM WITH THE CLIENT: the WordPress
 *  Contact Form 7 recipient is stored in the WordPress admin, which this
 *  migration never read, so this is inferred from the markup rather than
 *  carried over. */
export const TO = ['dispatch@rexdalemobilewash.ca'];

/** Reply-To: the client's own address (gate 11). The From address is a TBOX
 *  domain nobody reads, so without this a reply would go to TBOX. */
export const REPLY_TO = 'dispatch@rexdalemobilewash.ca';

/** Shown to the visitor. CF7's own default strings, so the wording on the page
 *  does not change either. */
export const MESSAGES = {
  sent: 'Thank you for your message. It has been sent.',
  failed: 'There was an error trying to send your message. Please try again later.',
  invalid: 'One or more fields have an error. Please check and try again.',
  spam: 'There was an error trying to send your message. Please try again later.',
};
