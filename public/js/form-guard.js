/* Arms every form on the page: Turnstile, the dwell-time stamp, and the CF7
 * submit handler.
 *
 * Nothing here is a security control. Every check it feeds is re-decided on the
 * Worker, which trusts none of this: the timestamp is client-supplied and
 * forgeable, and the Turnstile token is only worth anything because the server
 * verifies it against siteverify. What this file does is make a real visitor's
 * submission carry what the server needs, invisibly.
 *
 * Two forms, handled differently on purpose:
 *
 *   .wpcf7-form      Contact Form 7's markup, on 14 pages. CF7's own script is
 *                    not shipped (it needs the WordPress AJAX endpoint), so this
 *                    file submits it and paints the result using CF7's own
 *                    classes — the site already carries CF7's stylesheet, so
 *                    form.sent is green, form.invalid yellow, form.failed red
 *                    with no new CSS.
 *   .u-inner-form    Nicepage's, on /residential/. nicepage.js already submits
 *                    it to the form's action and reads {success:true} back, so
 *                    this file only arms the guards and stays out of the way.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/contact/'; // slashed: the unslashed form 308s (trailingSlash: 'always')
  var TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  var MESSAGES = {
    sent: 'Thank you for your message. It has been sent.',
    failed: 'There was an error trying to send your message. Please try again later.',
    invalid: 'One or more fields have an error. Please check and try again.',
  };

  /* The sitekey is public by design, but it is not committed: the layout writes
   * it into a meta tag from a build variable. No sitekey means no widget, which
   * means the server rejects everything — so say so in the console rather than
   * letting it look like a mystery. bin/check-forms.mjs fails the build for
   * exactly this, so it should never reach a browser. */
  function sitekey() {
    var meta = document.querySelector('meta[name="turnstile-sitekey"]');
    var key = meta && meta.getAttribute('content');
    if (!key) {
      console.error('[form-guard] no Turnstile sitekey on this page — submissions ' +
        'will be rejected by the server. Set PUBLIC_TURNSTILE_SITEKEY and rebuild.');
    }
    return key || '';
  }

  var forms = [];
  var scriptRequested = false;

  /* ------------------------------------------------------------ Turnstile */

  function loadTurnstile(onReady) {
    if (window.turnstile) return onReady();
    if (scriptRequested) return;         // one <script> for the whole page
    scriptRequested = true;
    window.onTurnstileReady = onReady;
    var s = document.createElement('script');
    s.src = TURNSTILE_SRC + '&onload=onTurnstileReady';
    s.async = true;
    s.defer = true;
    s.onerror = function () {
      // Loud, and visible to the visitor the moment they try to submit — never a
      // silent failure. The server rejects a tokenless submission anyway; this
      // just makes the reason legible.
      console.error('[form-guard] Turnstile script failed to load. Submissions will be ' +
        'rejected until it does.');
    };
    document.head.appendChild(s);
  }

  function renderWidget(entry) {
    var key = sitekey();
    if (!key || !window.turnstile) return;
    entry.widgetId = window.turnstile.render(entry.mount, {
      sitekey: key,
      // The whole point: the widget only becomes visible if a visitor genuinely
      // has to interact. Everyone else sees nothing and clicks nothing. It is
      // NOT hidden with CSS — if Turnstile does need a human, they must be able
      // to see it, or the form is a dead end for a real customer.
      appearance: 'interaction-only',
      // Solve on render, not on submit, so the token is already in the form by
      // the time anyone finishes typing.
      execution: 'render',
      // A form left open for more than five minutes would otherwise submit an
      // expired token and be rejected for looking like a replay.
      'refresh-expired': 'auto',
      // Puts the token in a hidden input inside this form, which is what makes
      // the no-JavaScript-of-ours path still carry one.
      'response-field': true,
      'response-field-name': 'cf-turnstile-response',
      'error-callback': function (code) {
        console.error('[form-guard] Turnstile error', code);
      },
    });
  }

  /** A fresh token, waiting for the widget if it has not solved yet. */
  function token(entry) {
    if (!window.turnstile || entry.widgetId == null) return Promise.resolve('');
    var have = window.turnstile.getResponse(entry.widgetId);
    if (have) return Promise.resolve(have);
    // Expired or not yet solved: ask for one and wait, bounded, so a visitor
    // never watches a spinner forever.
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v || ''); } };
      try {
        window.turnstile.execute(entry.widgetId, { callback: finish });
      } catch (e) { finish(''); }
      setTimeout(function () { finish(window.turnstile.getResponse(entry.widgetId)); }, 8000);
    });
  }

  /* ------------------------------------------------- CF7 response painting */

  function setStatus(form, status, message) {
    form.classList.remove('init', 'submitting', 'sent', 'failed', 'invalid', 'spam');
    if (status) form.classList.add(status);
    form.setAttribute('data-status', status || 'init');

    var out = form.querySelector('.wpcf7-response-output');
    if (!out) return;
    out.textContent = message || '';
    // aria-hidden on the box now carrying the only feedback would hide the result
    // from a screen reader entirely; role=status announces it.
    out.setAttribute('aria-hidden', message ? 'false' : 'true');
    if (message) out.setAttribute('role', 'status');
  }

  function clearTips(form) {
    form.querySelectorAll('.wpcf7-not-valid-tip').forEach(function (t) { t.remove(); });
    form.querySelectorAll('.wpcf7-not-valid').forEach(function (el) {
      el.classList.remove('wpcf7-not-valid');
      el.setAttribute('aria-invalid', 'false');
    });
  }

  function markInvalid(form, names) {
    names.forEach(function (name) {
      var field = form.querySelector('[name="' + name + '"]');
      if (!field) return;
      field.classList.add('wpcf7-not-valid');
      field.setAttribute('aria-invalid', 'true');
      var wrap = field.closest('.wpcf7-form-control-wrap') || field.parentNode;
      var tip = document.createElement('span');
      tip.className = 'wpcf7-not-valid-tip';
      tip.setAttribute('aria-hidden', 'true');
      tip.textContent = field.type === 'email' && field.value
        ? 'Please enter an email address.'
        : 'Please fill out this field.';
      wrap.appendChild(tip);
    });
    var first = form.querySelector('.wpcf7-not-valid');
    if (first) first.focus();
  }

  /* No spinner element, deliberately. CF7's own script inserts
   * `<span class="wpcf7-spinner">` beside the submit button and the vendored
   * stylesheet still carries the rules for it, so adding one is two lines. It is
   * also `display:inline-block; width:24px; margin:0 24px`, and
   * `visibility:hidden` reserves space — it would park 72px beside the button on
   * all 14 form pages, permanently, for a one-second animation. Disabling the
   * button gives the same feedback and costs no layout. */
  function setBusy(form, busy) {
    var submit = form.querySelector('.wpcf7-submit');
    if (submit) submit.disabled = busy;
  }

  function onSubmit(event) {
    var form = event.currentTarget;
    var entry = form.__guard;
    event.preventDefault();
    if (form.dataset.status === 'submitting') return;

    clearTips(form);
    setStatus(form, 'submitting', '');
    setBusy(form, true);

    token(entry).then(function (t) {
      var data = {};
      new FormData(form).forEach(function (value, key) {
        if (typeof value === 'string') data[key] = value;
      });
      if (t) data['cf-turnstile-response'] = t;

      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      }).then(function (res) {
        return res.json().catch(function () { return { status: 'failed' }; });
      });
    })
      .then(function (result) {
        setBusy(form, false);
        var status = result.status === 'sent' || result.status === 'invalid'
          ? result.status : 'failed';
        // The server's own message, not a generic one: a visitor turned away by a
        // guard is told what to do about it.
        setStatus(form, status, result.message || MESSAGES[status]);
        if (status === 'invalid') markInvalid(form, result.invalid || []);
        if (status === 'sent') {
          form.reset();
          // reset() blanks the dwell stamp and the token field; re-arm so a
          // second, genuine enquiry from the same visitor is not rejected.
          stamp(form);
          if (window.turnstile && entry.widgetId != null) {
            window.turnstile.reset(entry.widgetId);
          }
        }
      })
      .catch(function () {
        // A network failure, not a rejection: the visitor's message is still in
        // the fields, so it is not lost by resetting the form.
        setBusy(form, false);
        setStatus(form, 'failed', MESSAGES.failed);
      });
  }

  /* The no-JS path lands back here as ?form=sent|invalid|failed. Render it the
   * same way, then strip the parameter so a refresh does not re-announce it. */
  function handleRedirectResult(cf7Forms) {
    var status = new URLSearchParams(location.search).get('form');
    if (!status || !MESSAGES[status] || !cf7Forms.length) return;
    setStatus(cf7Forms[0], status, MESSAGES[status]);
    var url = new URL(location.href);
    url.searchParams.delete('form');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  /* ------------------------------------------------------------------ init */

  function stamp(form) {
    var field = form.querySelector('[name="form-loaded-at"]');
    if (field) field.value = String(Date.now());
  }

  function init() {
    var all = Array.prototype.slice.call(
      document.querySelectorAll('form.wpcf7-form, form.u-inner-form'));
    if (!all.length) return;

    all.forEach(function (form) {
      var mount = form.querySelector('.cf-turnstile-mount');
      var entry = { form: form, mount: mount, widgetId: null };
      form.__guard = entry;
      forms.push(entry);
      stamp(form);
      // Only CF7's form needs a submit handler; nicepage.js owns its own, and
      // takes the token straight out of the form because Turnstile put it there.
      if (form.classList.contains('wpcf7-form')) {
        form.addEventListener('submit', onSubmit);
      }
    });

    handleRedirectResult(all.filter(function (f) {
      return f.classList.contains('wpcf7-form');
    }));

    if (sitekey()) {
      loadTurnstile(function () { forms.forEach(renderWidget); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
