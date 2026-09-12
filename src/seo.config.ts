// Everything this port ADDS to the live site's SEO.
//
// The live site's own metadata — every title, description, canonical, robots
// directive, Open Graph tag, twitter:* tag and Yoast JSON-LD graph — is carried
// over verbatim by the port and lives in the generated `src/pages/*.astro`
// files. `tools/verify/compare-head.py` proves that, tag for tag, against the
// live site. Nothing in this file removes any of it.
//
// It lives here, hand-written, rather than in the page files, because
// `tools/gen_pages.py` OWNS those files: it rewrites all 19 of them from the
// captured `pages_meta.json`. Anything added there is lost the next time the
// port is regenerated. SiteBase.astro applies what is below on top of the
// ported props at render time, so the two can never drift apart.
//
// Every value here is sourced from the client's own pages or from the media
// already in the bucket. Nothing is invented: there is no `geo`, because no
// verified coordinates exist for the address, and no `openingHours`, because
// the site does not publish any.

/** The production origin. Matches `site` in astro.config.mjs. */
import NOINDEX from '../seo-noindex.json';

export const SITE = 'https://www.rexdalemobilewash.ca';

const IMG = 'https://img.rexdalemobilewash.ca';

/**
 * The business, as its own pages state it.
 *
 *   name, address   footer on all 15 Nicepage pages, and the contact block:
 *                   "Rexdale Mobile Wash Inc. / 41 Shaft Rd, Etobicoke, ON M9W 4M3"
 *   telephone       the `tel:` href on 17 pages, in E.164
 *   email           customerservice@, the address in the page bodies and the
 *                   form recipient (see src/contact.config.ts). The footer's
 *                   dispatch@ is the dispatch desk, not the general enquiry line.
 *   founded         "Since 1966" (/what-we-do/ meta description)
 *   areaServed      "in the GTA" and "all across Ontario" (same page)
 */
export const BUSINESS = {
  name: 'Rexdale Mobile Wash Inc.',
  legalName: 'Rexdale Mobile Wash Inc.',
  telephone: '+1-416-244-6497',
  email: 'customerservice@rexdalemobilewash.ca',
  foundingDate: '1966',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '41 Shaft Rd',
    addressLocality: 'Etobicoke',
    addressRegion: 'ON',
    postalCode: 'M9W 4M3',
    addressCountry: 'CA',
  },
  areaServed: [
    { '@type': 'City', name: 'Toronto' },
    { '@type': 'AdministrativeArea', name: 'Greater Toronto Area' },
    { '@type': 'AdministrativeArea', name: 'Ontario' },
  ],
  description:
    'Mobile pressure washing and industrial cleaning across the Greater Toronto Area since 1966.',
} as const;

/**
 * Share images.
 *
 * The live site ships `og:image` on exactly two of its 19 pages — /lookbook/
 * and /author/admin/ — so every other link posted to Facebook, LinkedIn, Slack
 * or iMessage renders as a grey box with no picture. Each page below gets its
 * own hero, the image a visitor actually sees at the top of that page.
 *
 * Dimensions are the real ones, read from the file in the bucket rather than
 * from the markup (the markup's width/height are the rendered size, which is
 * not what a crawler needs). Every URL is on the image host, so
 * bin/check-images.mjs polices them under AD-9 like any other image.
 *
 * Three of these are portrait or square, because that is the shape of the
 * photograph on the page. Cards crop to centre; a real photo of the work beats
 * a correctly-proportioned logo.
 */
type Share = { url: string; width: number; height: number; alt: string };

const DEFAULT_SHARE: Share = {
  url: `${IMG}/2020/12/slidehomepage1-scaled.jpg`,
  width: 2560,
  height: 1112,
  alt: 'A Rexdale Mobile Wash pressure-washing truck on site',
};

const SHARE: Record<string, Share> = {
  home: DEFAULT_SHARE,
  'about-us': DEFAULT_SHARE,
  'contact-us': DEFAULT_SHARE,
  residential: DEFAULT_SHARE,
  'what-we-do': {
    url: `${IMG}/2020/12/POWERWASH-1.jpg`,
    width: 1714, height: 1143,
    alt: 'High-pressure washing in progress',
  },
  'who-we-service': {
    url: `${IMG}/2020/12/rexdaletrucks-scaled.jpg`,
    width: 2560, height: 968,
    alt: 'The Rexdale Mobile Wash truck fleet',
  },
  buildings: {
    url: `${IMG}/2020/12/BILD1.jpg`,
    width: 960, height: 540,
    alt: 'A building exterior being pressure washed',
  },
  'de-icing-service': {
    url: `${IMG}/2020/12/ICE1-scaled.jpg`,
    width: 2560, height: 1752,
    alt: 'Mobile de-icing work on a frozen site',
  },
  'fleet-washing': {
    url: `${IMG}/2020/12/mobilefleetwashing-1-scaled.jpg`,
    width: 2560, height: 1112,
    alt: 'A truck fleet being washed on site',
  },
  'garbage-rooms': {
    url: `${IMG}/2020/12/GARBAGE-1-scaled.jpg`,
    width: 1923, height: 2560,
    alt: 'A garbage room being pressure washed and disinfected',
  },
  'graffiti-removal': {
    url: `${IMG}/2020/12/grafitiremoval-1-scaled.jpg`,
    width: 2560, height: 1112,
    alt: 'Graffiti being removed from a wall',
  },
  'heavy-equipment-washing': {
    url: `${IMG}/2020/12/heavyequipmentcleaning-scaled.jpg`,
    width: 2560, height: 1112,
    alt: 'Heavy construction equipment being cleaned',
  },
  'parking-underground': {
    url: `${IMG}/2020/12/NDER1-scaled.jpg`,
    width: 2560, height: 2489,
    alt: 'An underground parking garage being cleaned',
  },
  'storefronts-3': {
    url: `${IMG}/2020/12/storefronts-1-scaled.jpg`,
    width: 2560, height: 1112,
    alt: 'A storefront being pressure washed',
  },
  'water-tanker-service': {
    url: `${IMG}/2026/04/Tanker2backwbck.png`,
    width: 1536, height: 1024,
    alt: 'A Rexdale Mobile Wash bulk water tanker',
  },
  'blog-post-title': DEFAULT_SHARE,
  '404': DEFAULT_SHARE,
};

/**
 * The two og:image URLs the live site already emits, measured.
 *
 * Yoast ships the URL alone. A crawler with no dimensions has to download the
 * file before it can decide how to lay the card out, and several — Slack and
 * iMessage among them — give up and show no picture rather than wait. These
 * pages keep Yoast's image; all that is added is its size and a description of it.
 */
const PORTED_SHARE: Record<string, Omit<Share, 'url'>> = {
  [`${IMG}/2020/12/image-1.jpg`]: {
    width: 1193, height: 1800,
    alt: 'Pressure washing work from the Rexdale Mobile Wash lookbook',
  },
  [`${IMG}/2020/12/logoclear-1.png`]: {
    width: 1142, height: 264,
    alt: 'The Rexdale Mobile Wash Inc. logo',
  },
};

/**
 * The share card for a page.
 *
 * `emitUrl` is false where the ported metadata already carries an og:image:
 * that URL stays exactly as Yoast wrote it — a second og:image would only make
 * the crawler choose — and only the missing dimensions and alt text are added.
 * Returns null when there is nothing to add.
 */
export function shareImage(
  slug: string,
  portedOg: [string, string][],
): (Share & { emitUrl: boolean }) | null {
  const existing = portedOg.find(([p]) => p === 'og:image');
  if (existing) {
    const known = PORTED_SHARE[existing[1]];
    return known ? { url: existing[1], ...known, emitUrl: false } : null;
  }
  const share = SHARE[slug];
  return share ? { ...share, emitUrl: true } : null;
}

/**
 * Descriptions the live site is missing or has wrong.
 *
 * Only four pages are touched, and each for a stated reason. Every other page
 * keeps Yoast's description exactly as written.
 */
const DESCRIPTIONS: Record<string, string> = {
  // The live page carries /de-icing-service/'s description word for word — a
  // copy-paste in Yoast that leaves two pages competing on the same snippet
  // while saying nothing about bulk water. Replaced with this page's own copy.
  'water-tanker-service':
    'Fast, reliable bulk water delivery across the GTA — construction, ' +
    'landscaping, municipal and industrial. High-capacity tankers, scheduled ' +
    'or on demand.',
  // The four pages below carry no description at all on the live site, so the
  // snippet is whatever Google scrapes — on these four, that is the navigation
  // menu, which is the same on every page.
  lookbook:
    'A gallery of pressure washing, graffiti removal and industrial cleaning ' +
    'work by Rexdale Mobile Wash across the Greater Toronto Area.',
  '404':
    'That page could not be found. Rexdale Mobile Wash provides mobile ' +
    'pressure washing and industrial cleaning across the GTA — call ' +
    '1 (416) 244-6497.',
  // Written to describe these two honestly rather than to flatter them: both
  // are WordPress placeholder content ("What goes into a blog post?") that the
  // live site publishes and lists in its sitemaps. See "Two thin pages" in the
  // README — whether they should stay indexed at all is the client's call, and
  // this file does not make it.
  'blog-post-title':
    'A placeholder post on the Rexdale Mobile Wash website. For our services, ' +
    'see What We Do — pressure washing and industrial cleaning across the GTA.',
  'author-admin':
    'Posts published by admin on the Rexdale Mobile Wash website.',
};

/** The description to render: an override where one exists, else the ported value. */
export function describe(slug: string, ported?: string): string | undefined {
  return DESCRIPTIONS[slug] ?? ported;
}

/**
 * Pages kept out of the index.
 *
 * The list is in `seo-noindex.json` rather than here, because it is read in two
 * languages: this file renders the meta tag, `tools/gen_sitemaps.py` leaves the
 * page out of the sitemaps, and `bin/check-sitemaps.mjs` fails the build if the
 * two ever disagree. A page that is noindex and still in a sitemap asks Google
 * for exactly what its own markup refuses, and Search Console reports the pair
 * as an error.
 *
 * This overrides the live site's value, which is `index, follow` on both pages.
 * It is the one place the port deliberately tells crawlers something different
 * from what WordPress told them — recorded under Deliberate differences.
 */
export function robotsFor(slug: string, ported?: string): string | undefined {
  return slug in NOINDEX.slugs ? NOINDEX.directive : ported;
}

/**
 * Open Graph, de-duplicated.
 *
 * Every page on the live site emits TWO competing sets of OG tags: Nicepage
 * writes its own from the page body, then Yoast writes the real ones. The
 * result is that `og:title` and `og:description` appear twice with different
 * values, and consumers take the FIRST — which is Nicepage's. On the home page
 * that first `og:description` is 1,100 characters of carousel text scraped out
 * of the DOM, whitespace and all ("BULK WATER DELIVERY learn more FLEET
 * WASHING learn more..."); on /author/admin/ the first `og:url` is
 * `/author/admin?author_name=admin`, a query-string form of the URL that the
 * page's own canonical contradicts.
 *
 * So: for the properties that may only hold one value, keep the LAST one
 * written — Yoast's, the one somebody actually authored — in the position the
 * first appeared. Nothing is invented and nothing is lost: where Yoast wrote no
 * value (/lookbook/'s og:description) the surviving value is Nicepage's, which
 * is what a crawler would have used anyway.
 *
 * `og:image` and the `article:*` stamps are left untouched — they are legitimately
 * repeatable and are never duplicated on this site.
 */
const SINGLE_VALUE = new Set([
  'og:title', 'og:description', 'og:url', 'og:type', 'og:site_name', 'og:locale',
]);

export function dedupeOg(og: [string, string][]): [string, string][] {
  const last = new Map<string, string>();
  for (const [p, c] of og) if (SINGLE_VALUE.has(p)) last.set(p, c);

  const emitted = new Set<string>();
  const out: [string, string][] = [];
  for (const [p, c] of og) {
    if (!SINGLE_VALUE.has(p)) { out.push([p, c]); continue; }
    if (emitted.has(p)) continue;
    emitted.add(p);
    out.push([p, last.get(p)!]);
  }
  return out;
}

/** Service pages, and the service each one sells. */
const SERVICES: Record<string, { name: string; serviceType: string }> = {
  buildings: {
    name: 'Building Exterior & Interior Pressure Washing',
    serviceType: 'Pressure washing',
  },
  'de-icing-service': { name: 'Mobile De-Icing Service', serviceType: 'De-icing' },
  'fleet-washing': { name: 'Mobile Fleet Pressure Washing', serviceType: 'Fleet washing' },
  'garbage-rooms': {
    name: 'Garbage Room Pressure Washing & Disinfecting',
    serviceType: 'Pressure washing',
  },
  'graffiti-removal': { name: 'Graffiti Removal', serviceType: 'Graffiti removal' },
  'heavy-equipment-washing': {
    name: 'Heavy Equipment Washing',
    serviceType: 'Equipment cleaning',
  },
  'parking-underground': {
    name: 'Parking Garage & Underground Cleaning',
    serviceType: 'Pressure washing',
  },
  'storefronts-3': { name: 'Storefront Pressure Washing', serviceType: 'Pressure washing' },
  'water-tanker-service': { name: 'Bulk Water Delivery', serviceType: 'Water delivery' },
  residential: { name: 'Residential Pressure Washing', serviceType: 'Pressure washing' },
};

/** WebPage subtypes that say what a page IS, where the page has an obvious one. */
const PAGE_TYPE: Record<string, string> = {
  'contact-us': 'ContactPage',
  'about-us': 'AboutPage',
  lookbook: 'CollectionPage',
};

type Node = Record<string, unknown>;
const typesOf = (n: Node): string[] => {
  const t = n['@type'];
  return Array.isArray(t) ? t as string[] : typeof t === 'string' ? [t] : [];
};
/** Add `extra` to a node's @type without disturbing what is already declared. */
const addType = (n: Node, extra: string) => {
  const t = typesOf(n);
  if (!t.includes(extra)) n['@type'] = [...t, extra];
};

/**
 * The ported Yoast graph, enriched.
 *
 * Purely additive, and deliberately so: every node and every property the live
 * site emits survives byte-for-byte, including the `SearchAction` that points
 * at a WordPress search this site does not have (README: "Known issues carried
 * over" — changing that is the client's call, not this file's). Only keys that
 * are absent are filled in.
 *
 * What it adds:
 *
 *   * the `Organization` node also becomes a `ProfessionalService` — a
 *     LocalBusiness subtype — and gains the address, phone, email, founding year
 *     and service area printed on the pages. This is the single biggest gap in
 *     the live site's structured data: a local trade business, 60 years in one
 *     city, publishing no machine-readable address at all.
 *   * service pages gain a `Service` node naming what they sell, with the
 *     organisation as `provider` and the GTA as `areaServed`.
 *   * the contact, about and gallery pages declare what kind of page they are.
 *
 * Returns the JSON string to embed, or the input unchanged if it cannot be
 * parsed — a page must never fail to render because of this.
 */
export function enrichJsonLd(
  jsonld: string | null | undefined,
  slug: string,
  page: { canonical?: string; description?: string; image?: Share | null },
): string | null | undefined {
  if (!jsonld) return jsonld;

  let doc: Node;
  try {
    doc = JSON.parse(jsonld) as Node;
  } catch {
    return jsonld;
  }
  const graph = doc['@graph'];
  if (!Array.isArray(graph)) return jsonld;

  const org = graph.find((n: Node) => typesOf(n).includes('Organization')) as Node | undefined;
  if (org) {
    addType(org, 'ProfessionalService');
    const fill: Node = {
      legalName: BUSINESS.legalName,
      description: BUSINESS.description,
      telephone: BUSINESS.telephone,
      email: BUSINESS.email,
      foundingDate: BUSINESS.foundingDate,
      address: BUSINESS.address,
      areaServed: BUSINESS.areaServed,
    };
    for (const [k, v] of Object.entries(fill)) if (!(k in org)) org[k] = v;
  }

  const webpage = graph.find((n: Node) => typesOf(n).includes('WebPage')) as Node | undefined;
  if (webpage && PAGE_TYPE[slug]) addType(webpage, PAGE_TYPE[slug]);

  const service = SERVICES[slug];
  if (service && org) {
    const id = `${page.canonical ?? SITE}#service`;
    if (!graph.some((n: Node) => n['@id'] === id)) {
      graph.push({
        '@type': 'Service',
        '@id': id,
        name: service.name,
        serviceType: service.serviceType,
        ...(page.description ? { description: page.description } : {}),
        ...(page.canonical ? { url: page.canonical } : {}),
        ...(page.image ? { image: page.image.url } : {}),
        provider: { '@id': org['@id'] },
        areaServed: BUSINESS.areaServed,
        ...(webpage?.['@id'] ? { mainEntityOfPage: { '@id': webpage['@id'] } } : {}),
      });
    }
  }

  return JSON.stringify(doc);
}
