-- Form submissions.
--
--     npx wrangler d1 execute rexdalemobilewash-forms --remote --file migrations/0001_submissions.sql
--
-- Why the site needs this at all, given every submission is emailed: because
-- email is the one step here that can fail after the visitor has been told it
-- worked. Resend can be down, the domain can be suspended, a notification can
-- land in a junk folder nobody opens. Each of those loses a lead silently, and
-- the client finds out weeks later by not hearing from someone.
--
-- So the row is written BEFORE the email is attempted, and updated with the
-- outcome afterwards. A submission that reaches this table is not lost, whatever
-- Resend does next — `SELECT * FROM submissions WHERE resend_status <> 'sent'`
-- is the list of people who need chasing.

CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,          -- uuid, generated per submission
  created_at      TEXT NOT NULL,             -- ISO 8601, UTC

  -- which form, and where from
  form            TEXT NOT NULL,             -- 'cf7' | 'nicepage'
  page            TEXT NOT NULL,             -- the path the visitor submitted from

  -- what they sent. `subject` is null for the Nicepage form, which has no
  -- subject field; `message` holds its Address value, which is what that form
  -- actually asks for.
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  subject         TEXT,
  message         TEXT,

  -- who, for tracing a suspicious one without digging through Worker logs that
  -- have already rolled off
  ip              TEXT,
  country         TEXT,
  city            TEXT,
  region          TEXT,
  user_agent      TEXT,

  -- what happened to the email
  resend_status   TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'sent' | 'failed'
  resend_id       TEXT,
  resend_error    TEXT,

  -- set by hand when somebody has actually replied, so the table is a worklist
  -- rather than only a log
  handled_at      TEXT
);

-- The two queries this table exists to answer.
--   "what came in, newest first"       -> created_at
--   "what did not get emailed"         -> resend_status
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status  ON submissions (resend_status);

-- The hourly rate limit reads this: count a sender's rows in the last hour.
-- Cloudflare's rate-limiting binding cannot express an hour (its period is 10 or
-- 60 seconds), and the KV namespace that was going to carry it never got
-- created. D1 does it properly and account-wide, where the binding counts per
-- data centre and is documented as "not an accurate accounting system".
CREATE INDEX IF NOT EXISTS idx_submissions_ip_time ON submissions (ip, created_at);
