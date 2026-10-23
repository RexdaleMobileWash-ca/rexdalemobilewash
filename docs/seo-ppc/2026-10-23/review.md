# 0007 Rexdale Mobile Wash — SEO/PPC review
Date: 2026-10-23. Repo: RexdaleMobileWash-ca/rexdalemobilewash.
Base SHA: 721957c4edfdc4139d761b2bf879fa8bbeb1569f. Branch: chatgpt/seo-0007-20261023.
Live: https://www.rexdalemobilewash.ca/ . Isolated staging: https://astro.rexdalemobilewash.ca/ .

## Crawl and evidence
Agrici SEO-pro v0.2.17, exact plugin Plugin_1d491eff012c819198acff9d849ddd58; current router, seo-audit, operating contract and full-crawl protocol directed full discovery/fetch/extraction using Python requests/BeautifulSoup on Samay. Applied page, technical, content, schema, sitemap, images, local, SXO and drift workflows.
83 HTTP records:70 HTTP200,13 HTTP404; four private/authenticated/state-changing URL exclusions; zero remaining frontier. Covered all discovered public routes, sitemap children, repository routes and prior inventory; retained pagination/feed variants and failed URLs. Counts include variants and sitemap/robots records, not83 unique content pages. All available live/staging page families included; no robots bypass.
crawl.json retains per-URL extraction/status/redirect/evidence. Raw sources persist at C:\Users\TBOX 20251029\website-reviews\0007-seo-pro-crawl-20261023\ on Samay; source_file and SHA256 fields identify responses.
No ranking, traffic, keyword volume or conversion-uplift claims.

## Findings / implemented actions
| URL/file | Observation/evidence dated2026-10-23 | Priority/confidence | Action and verification |
|---|---|---|---|
| /buildings/ and /contact-us/; src/seo.config.ts | Descriptions196/208 characters obscure core service/contact intent; source/crawl and existing lint | P2/high | Concise factual summaries of visible services/contact details; normal SEO check now zero warnings. |
| /parking-underground/; src/seo.config.ts | Metadata spelling/grammar errors: company's, What ever, florr | P2/high | Replace snippet with factual parking cleaning/power scrubbing/sweeping description. Body/layout unchanged. |
| Shared SiteBase + seo.config | SEO overrides were not consistently reflected in OG/WebPage data, including tanker-service correction | P2/high | Align rendered description across search/social/schema fields; all17 WebPage graph nodes checked successfully. |
| WebSite JSON-LD | SearchAction advertises retired WordPress ?s search; repository has no search implementation | P2/high | Remove only that SearchAction at render-time. Preserve all other actions/business facts; checker finds none remaining. |
| Placeholder post/admin archive, legacy feed retirement | Existing content/indexing decisions explicitly documented | P3/high observation | Preserve pending manual retirement decisions; no invented content or unauthorized route removal. |
| Carousel/footer heading hierarchy and historical visual issues | Existing multi-heading/template structure | Follow-up; impact requires presentation review | Leave visual/heading restyling to formatting; no CSS or body markup edits. |

## Actual checks and scope
npm ci completed. Normal npm run build passed:19pages; SEO zero warnings/failures; image-host checks passed;15 forms passed existing build-time markup checks; sitemap checks18routes,3child sitemaps,478image entries/224distinct images,zero problems. Build-time form markup checking is NOT submission, database or persistence testing.
python bin/check-seo-review.py passed:19HTML pages,17WebPage descriptions agree with metadata; OG descriptions agree; retired search action absent. git diff --check passed.
Source changes confined to metadata config/document-head plumbing plus evidence/checker. No stylesheets, body markup, JavaScript interactions, GTM, CTA destinations, form handlers, database bindings/schema changes. Existing published public Turnstile sitekey reused at build time; no credential/authentication changes, no replacement keys or CAPTCHA tests.
Skipped: viewport/pixel parity, lightbox coverage, form/CAPTCHA submission, persistence/database health/connectivity and email-delivery tests. Existing behavior accepted under user limitations, not asserted as end-to-end proven.

## Deployment and manual production instructions
Cloudflare provider verified Worker rexdalemobilewash has only astro.rexdalemobilewash.ca custom domain in controlled active zone, with no matching Worker routes. Production WordPress is separate. Preserve host-scoped X-Robots-Tag noindex protection and production canonicals; no DNS or trigger changes.
Deploy exact reviewed feature SHA only to this existing isolated staging Worker. Record version/deployment and provider completion in PR/Website Desk. Provider rejection remains a genuine blocker; do not alter database bindings to bypass it.
Formatting PR/review not present; independent SEO push/deploy proceeds. Combined approval and actual final DOCX email remain pending separate formatting evidence.
Manual integration: reconcile this SEO feature PR with later formatting PR without merging another task's work; review final combined SHA before whole-site approval.
Production was NOT deployed. Manual cutover follows repository instructions and requires deliberate control of hostname-specific noindex/header policy, redirects and existing bot-protection settings. No automatic main push/merge/DNS changes.
Rollback: preserve prior staging version before activation; redeploy exact prior version or manually revert this PR preserving unrelated changes. After deployment verify provider revision, target GETs, expected metadata/schema, X-Robots-Tag, sitemap and unchanged contact destinations. No real test leads.
