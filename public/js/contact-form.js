/* Submit the contact form to /api/contact without leaving the page.
 *
 * Contact Form 7's own script is not shipped — it needs the WordPress AJAX
 * endpoint. This replaces the part of it the page depends on, and nothing else.
 *
 * It sets the same classes CF7 sets, because the site already carries CF7's
 * stylesheet verbatim: `form.submitting` shows the spinner, `form.sent` turns
 * the response box green, `form.invalid` yellow, `form.failed` red, and
 * `.wpcf7-not-valid-tip` marks a field. So the states look exactly like the
 * original without a line of new CSS.
 *
 * The form still works with this file absent or blocked: its action and method
 * point at the same endpoint, which handles a native form post and answers with
 * a 303 back to the page carrying ?form=sent. handleRedirectResult() below
 * renders that case into the same response box.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/contact/'; // slashed: the unslashed form 308s (trailingSlash: 'always')
  var MESSAGES = {
    sent: 'Thank you for your message. It has been sent.',
    failed: 'There was an error trying to send your message. Please try again later.',
    invalid: 'One or more fields have an error. Please check and try again.',
  };

  function setStatus(form, status, message) {
    // CF7 keeps the state in both places and its CSS reads the class.
    form.classList.remove('init', 'submitting', 'sent', 'failed', 'invalid', 'spam');
    if (status) form.classList.add(status);
    form.setAttribute('data-status', status || 'init');

    var out = form.querySelector('.wpcf7-response-output');
    if (!out) return;
    out.textContent = message || '';
    // aria-hidden on a box that now carries the only feedback would hide the
    // result from a screen reader entirely; role=status announces it.
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

  /* No spinner element, deliberately.
   *
   * CF7's own script inserts `<span class="wpcf7-spinner">` beside the submit
   * button, and the vendored stylesheet is still carrying the rules for it —
   * so adding one is a two-line change and tempting. It is also
   * `display:inline-block; width:24px; margin:0 24px`, and `visibility:hidden`
   * reserves space: it would park 72px beside the button on all 14 form pages,
   * permanently, for a one-second animation. The captured markup has the
   * button's `has-spinner` class but not the element, and matching the capture
   * is the brief.
   *
   * Feedback during the request comes from disabling the button instead, which
   * costs no layout at all. */
  function setBusy(form, busy) {
    var submit = form.querySelector('.wpcf7-submit');
    if (submit) submit.disabled = busy;
  }

  function onSubmit(event) {
    var form = event.currentTarget;
    event.preventDefault();
    if (form.dataset.status === 'submitting') return;

    clearTips(form);
    setStatus(form, 'submitting', '');
    setBusy(form, true);

    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (typeof value === 'string') data[key] = value;
    });

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (res) {
        return res.json().catch(function () { return { status: 'failed' }; });
      })
      .then(function (result) {
        setBusy(form, false);
        var status = result.status === 'sent' || result.status === 'invalid'
          ? result.status : 'failed';
        setStatus(form, status, result.message || MESSAGES[status]);
        if (status === 'invalid') markInvalid(form, result.invalid || []);
        if (status === 'sent') form.reset();
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
  function handleRedirectResult(forms) {
    var status = new URLSearchParams(location.search).get('form');
    if (!status || !MESSAGES[status] || !forms.length) return;
    setStatus(forms[0], status, MESSAGES[status]);
    var url = new URL(location.href);
    url.searchParams.delete('form');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  function init() {
    var forms = Array.prototype.slice.call(document.querySelectorAll('form.wpcf7-form'));
    forms.forEach(function (form) {
      form.addEventListener('submit', onSubmit);
    });
    handleRedirectResult(forms);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
