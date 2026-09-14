/**
 * Form submissions, stored in D1.
 *
 * The point is the ORDER. The row is written **before** Resend is called and
 * updated with the outcome after, so a submission that reaches this table is
 * never lost regardless of what the email does next. Write it after a successful
 * send and the failure mode is the one worth preventing: Resend is down, the
 * visitor is told "thank you, it has been sent", and the enquiry exists nowhere.
 *
 * Nothing here is allowed to break the form. Every call is wrapped: if D1 is
 * unavailable the submission still goes through and still gets emailed, and the
 * miss is logged loudly. A database outage must not cost the client a lead —
 * which is the same rule the email path already follows in the other direction.
 */

export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T = unknown>(): Promise<T | null>;
    };
  };
}

export interface SubmissionRow {
  id: string;
  form: string;
  page: string;
  name: string;
  email: string;
  subject: string | null;
  message: string | null;
  ip: string;
  country?: string;
  city?: string;
  region?: string;
  userAgent?: string;
}

const INSERT = `
  INSERT INTO submissions
    (id, created_at, form, page, name, email, subject, message,
     ip, country, city, region, user_agent, resend_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`;

const MARK_SENT = `
  UPDATE submissions SET resend_status = 'sent', resend_id = ? WHERE id = ?`;

const MARK_FAILED = `
  UPDATE submissions SET resend_status = 'failed', resend_error = ? WHERE id = ?`;

/**
 * Record the submission as pending. Returns true if the row landed.
 *
 * A false return is not a reason to stop: the caller sends the email anyway. It
 * means this one enquiry exists only in the notification, which is where every
 * enquiry lived before this table existed.
 */
export async function record(db: D1Like | undefined, row: SubmissionRow): Promise<boolean> {
  if (!db) {
    console.error('[submissions] no D1 binding — this submission is not being stored. ' +
      'Is FORMS_DB bound in wrangler.jsonc and the database created?');
    return false;
  }
  try {
    await db.prepare(INSERT).bind(
      row.id,
      new Date().toISOString(),
      row.form,
      row.page,
      row.name,
      row.email,
      row.subject,
      row.message,
      row.ip || null,
      row.country || null,
      row.city || null,
      row.region || null,
      row.userAgent || null,
    ).run();
    return true;
  } catch (e) {
    console.error('[submissions] insert failed —', (e as Error).message,
      '— the submission is continuing without being stored.');
    return false;
  }
}

/** Attach the outcome of the send to the row written above. */
export async function markSent(db: D1Like | undefined, id: string, resendId?: string) {
  if (!db) return;
  try {
    await db.prepare(MARK_SENT).bind(resendId || null, id).run();
  } catch (e) {
    console.error('[submissions] could not mark sent —', (e as Error).message);
  }
}

export async function markFailed(db: D1Like | undefined, id: string, why: string) {
  if (!db) return;
  try {
    // Truncated: a provider error body can be long, and the useful part is the
    // first line. The full text is in the Worker log either way.
    await db.prepare(MARK_FAILED).bind(why.slice(0, 500), id).run();
  } catch (e) {
    console.error('[submissions] could not mark failed —', (e as Error).message);
  }
}

/**
 * How many submissions this IP has stored in the last hour.
 *
 * This is what makes the hourly rate limit real. Cloudflare's rate-limiting
 * binding cannot express an hour — its period is 10 or 60 seconds — and it is
 * documented as counted per data centre and "intentionally designed to not be
 * used as an accurate accounting system". A count over D1 is account-wide and
 * exact.
 *
 * It counts STORED submissions, not attempts. That is the right measure for this
 * limit: the thing being rationed is enquiries reaching the client's inbox, and
 * an attempt rejected by Turnstile or the honeypot never gets near it. Attempts
 * are still capped by the burst limiter and are all in the log.
 *
 * Returns -1 when the count cannot be taken, which the caller treats as "do not
 * rate limit" — refusing real enquiries because the database is unreachable is
 * not a trade worth making.
 */
export async function recentCount(
  db: D1Like | undefined, ip: string, form: string, windowMs = 3600_000,
): Promise<number> {
  if (!db || !ip) return -1;
  const since = new Date(Date.now() - windowMs).toISOString();
  try {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM submissions WHERE ip = ? AND form = ? AND created_at > ?')
      .bind(ip, form, since)
      .first<{ n: number }>();
    return row ? Number(row.n) : -1;
  } catch (e) {
    console.error('[submissions] rate-limit count failed —', (e as Error).message,
      '— not limiting this submission.');
    return -1;
  }
}
