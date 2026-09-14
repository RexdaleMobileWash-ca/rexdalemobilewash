<?xml version="1.0" encoding="UTF-8"?>
<!--
  Human-readable rendering for the XML sitemaps.

  A sitemap is XML, written for crawlers. Opened in a browser it is a wall of
  angle brackets with no clickable links — so this stylesheet, named from each
  sitemap by an <?xml-stylesheet?> processing instruction, turns it into a table
  the client (or anyone auditing the site) can actually read and click through.
  Crawlers ignore the instruction entirely; the bytes Google parses are the same
  either way.

  XSLT 1.0 on purpose: every browser engine implements 1.0 and nothing above it.
  The file this replaced declared 2.0, which browsers silently downgrade.

  Nothing here is fetched from anywhere. No webfont, no script, no external
  stylesheet — a page whose job is to prove the sitemaps are intact should not
  be able to fail because a third party is down. Colours are the site's own
  (#478ac9), the type stack names the site's faces first and falls back to the
  system.
-->
<xsl:stylesheet version="1.0"
	xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
	xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
	xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<xsl:output method="html" encoding="UTF-8" indent="yes"
	doctype-system="about:legacy-compat"/>

<!-- One row's address, as a link.

     The <loc> in a sitemap is and must stay the canonical production address —
     that is the whole point of the file, and it is what Google is being told to
     index. But this page is also served from the review hostname, where a link
     straight to www. walks the reader off onto the old WordPress site mid-audit,
     which is the opposite of what a sitemap rendering is for.

     So the text shows the canonical address and the href is path-only. The
     browser resolves it against whatever host the reader is already on: on the
     review host the links stay on the review host, on production they resolve to
     production, and neither case needs to know which one it is.

     The address is also split — muted host, emphasised path — so the eye lands
     on the part that differs between rows instead of re-reading the domain 16
     times. On a phone the host is dropped outright: identical on every row, and
     the screen is 390px wide. A string not shaped like a URL is linked and shown
     verbatim rather than mangled. -->
<xsl:template name="loc-link">
	<xsl:param name="loc"/>
	<xsl:variable name="rest" select="substring-after($loc, '://')"/>
	<xsl:variable name="host" select="substring-before($rest, '/')"/>
	<xsl:choose>
		<xsl:when test="$host != ''">
			<a href="/{substring-after($rest, '/')}">
				<span class="host">
					<xsl:value-of select="substring-before($loc, $host)"/>
					<xsl:value-of select="$host"/>
				</span>
				<span class="path">
					<xsl:text>/</xsl:text>
					<xsl:value-of select="substring-after($rest, '/')"/>
				</span>
			</a>
		</xsl:when>
		<xsl:otherwise>
			<a href="{$loc}"><xsl:value-of select="$loc"/></a>
		</xsl:otherwise>
	</xsl:choose>
</xsl:template>

<!-- ISO 8601 in, "8 Sep 2026 · 14:16" out. XSLT 1.0 has no date type, so this is
     substring arithmetic and a lookup over a month string. -->
<xsl:template name="pretty-date">
	<xsl:param name="iso"/>
	<xsl:choose>
		<xsl:when test="string-length($iso) &gt;= 10">
			<xsl:variable name="m" select="substring($iso, 6, 2)"/>
			<xsl:value-of select="number(substring($iso, 9, 2))"/>
			<xsl:text> </xsl:text>
			<xsl:value-of select="substring('JanFebMarAprMayJunJulAugSepOctNovDec',
			                                (number($m) * 3) - 2, 3)"/>
			<xsl:text> </xsl:text>
			<xsl:value-of select="substring($iso, 1, 4)"/>
			<xsl:if test="string-length($iso) &gt;= 16">
				<span class="t">
					<xsl:text> · </xsl:text>
					<xsl:value-of select="substring($iso, 12, 5)"/>
				</span>
			</xsl:if>
		</xsl:when>
		<xsl:otherwise>—</xsl:otherwise>
	</xsl:choose>
</xsl:template>

<xsl:template match="/">
<html lang="en">
<head>
	<meta charset="UTF-8"/>
	<meta name="viewport" content="width=device-width, initial-scale=1"/>
	<meta name="robots" content="noindex, follow"/>
	<title>XML Sitemap · Rexdale Mobile Wash</title>
	<style>
		:root {
			--bg:     #ffffff;
			--panel:  #ffffff;
			--stripe: #f5f8fb;
			--ink:    #1a1a1a;
			--muted:  #6b7785;
			--line:   #e2e8f0;
			--brand:  #387cbd;
			--brandw: #478ac9;
		}
		@media (prefers-color-scheme: dark) {
			:root {
				--bg:     #12161b;
				--panel:  #171c22;
				--stripe: #1b212a;
				--ink:    #e8edf2;
				--muted:  #98a4b3;
				--line:   #2a323d;
				--brand:  #77aad9;
				--brandw: #adcce9;
			}
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			padding: 0 16px 64px;
			background: var(--bg);
			color: var(--ink);
			font: 15px/1.6 Roboto, 'Open Sans', -apple-system, BlinkMacSystemFont,
			      'Segoe UI', Helvetica, Arial, sans-serif;
			-webkit-text-size-adjust: 100%;
		}
		.wrap { max-width: 1060px; margin: 0 auto; }
		header { padding: 40px 0 8px; border-bottom: 3px solid var(--brandw); }
		h1 {
			margin: 0 0 6px;
			font-size: 28px;
			font-weight: 700;
			letter-spacing: -0.01em;
		}
		.lede { margin: 0; color: var(--muted); font-size: 14px; max-width: 68ch; }
		.count {
			display: inline-block;
			margin: 20px 0 14px;
			padding: 5px 12px;
			border-radius: 999px;
			background: var(--brandw);
			color: #fff;
			font-size: 13px;
			font-weight: 600;
		}
		.back {
			display: inline-block;
			margin: 20px 0 0 10px;
			font-size: 13px;
			color: var(--brand);
		}
		table {
			width: 100%;
			border-collapse: collapse;
			background: var(--panel);
			border: 1px solid var(--line);
			border-radius: 8px;
			overflow: hidden;
			table-layout: fixed;
		}
		thead th {
			padding: 11px 14px;
			background: var(--stripe);
			border-bottom: 1px solid var(--line);
			text-align: left;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: var(--muted);
			white-space: nowrap;
		}
		tbody td {
			padding: 10px 14px;
			border-top: 1px solid var(--line);
			font-size: 14px;
			vertical-align: top;
			overflow-wrap: anywhere;
		}
		tbody tr:nth-child(odd) td { background: var(--stripe); }
		tbody tr:hover td { background: rgba(71, 138, 201, 0.12); }
		/* Column widths live on the th, not in a colgroup. A col keeps reserving
		   its share even when every cell in it is display:none, so a colgroup
		   left the address column at 62% of a table with nothing beside it. */
		th.num { width: 16%; }
		th.when { width: 22%; }
		td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
		td.when, th.when { white-space: nowrap; color: var(--muted); font-size: 13px; }
		td.when .t { color: var(--muted); opacity: 0.75; }
		.host { color: var(--muted); }
		.path { font-weight: 500; }
		a { color: var(--brand); text-decoration: none; }
		a:hover, a:focus { text-decoration: underline; }
		a:focus-visible { outline: 2px solid var(--brandw); outline-offset: 2px; }
		.zero { color: var(--muted); }
		footer { margin-top: 22px; max-width: 78ch; color: var(--muted); font-size: 12px; }
		/* Below ~640px the two trailing columns cost more than they tell you, and
		   so does the host: it is identical on every row. Dropping the columns is
		   the address column then takes the whole width on its own. */
		@media (max-width: 640px) {
			h1 { font-size: 22px; }
			.num, .when, .host { display: none; }
			tbody td { font-size: 13px; }
		}
	</style>
</head>
<body>
<div class="wrap">

	<xsl:variable name="maps" select="count(sitemap:sitemapindex/sitemap:sitemap)"/>
	<xsl:variable name="urls" select="count(sitemap:urlset/sitemap:url)"/>

	<header>
		<h1>XML Sitemap</h1>
		<p class="lede">
			This XML sitemap is generated by the site's build and lists what search
			engines should crawl. It is meant for machines — this page is the same
			file, made readable.
		</p>
	</header>

	<!-- ============================================ the index of sitemaps -->
	<xsl:if test="$maps &gt; 0">
		<p>
			<span class="count">
				<xsl:value-of select="$maps"/>
				<xsl:text> sitemap</xsl:text>
				<xsl:if test="$maps != 1">s</xsl:if>
			</span>
		</p>
		<!-- Two columns, not three. A sitemap index carries no URL counts and XSLT
		     cannot open the files it points at, so a "URLs" column here would be a
		     column of em-dashes — width spent saying nothing. The link is the answer. -->
		<table>
			<thead>
				<tr>
					<th scope="col">Sitemap</th>
					<th scope="col" class="when">Last modified</th>
				</tr>
			</thead>
			<tbody>
				<xsl:for-each select="sitemap:sitemapindex/sitemap:sitemap">
					<tr>
						<td>
							<xsl:call-template name="loc-link">
								<xsl:with-param name="loc" select="sitemap:loc"/>
							</xsl:call-template>
						</td>
						<td class="when">
							<xsl:call-template name="pretty-date">
								<xsl:with-param name="iso" select="sitemap:lastmod"/>
							</xsl:call-template>
						</td>
					</tr>
				</xsl:for-each>
			</tbody>
		</table>
		<footer>Each row is a sitemap. Open one to see the addresses it lists.
		Addresses are shown as the sitemap records them — the production domain —
		but the links open on whichever host you are viewing this from.</footer>
	</xsl:if>

	<!-- ================================================= a single sitemap -->
	<xsl:if test="$maps &lt; 1">
		<p>
			<span class="count">
				<xsl:value-of select="$urls"/>
				<xsl:text> URL</xsl:text>
				<xsl:if test="$urls != 1">s</xsl:if>
			</span>
			<a class="back" href="/sitemap_index.xml">← all sitemaps</a>
		</p>
		<table>
			<thead>
				<tr>
					<th scope="col">URL</th>
					<th scope="col" class="num">Images</th>
					<th scope="col" class="when">Last modified</th>
				</tr>
			</thead>
			<tbody>
				<xsl:for-each select="sitemap:urlset/sitemap:url">
					<tr>
						<td>
							<xsl:call-template name="loc-link">
								<xsl:with-param name="loc" select="sitemap:loc"/>
							</xsl:call-template>
						</td>
						<td class="num">
							<xsl:variable name="n" select="count(image:image)"/>
							<xsl:choose>
								<xsl:when test="$n = 0"><span class="zero">—</span></xsl:when>
								<xsl:otherwise><xsl:value-of select="$n"/></xsl:otherwise>
							</xsl:choose>
						</td>
						<td class="when">
							<xsl:call-template name="pretty-date">
								<xsl:with-param name="iso" select="sitemap:lastmod"/>
							</xsl:call-template>
						</td>
					</tr>
				</xsl:for-each>
			</tbody>
		</table>
		<footer>
			<xsl:text>Images counts the </xsl:text>
			<code>&lt;image:image&gt;</code>
			<xsl:text> entries submitted with each page. Times are UTC. Addresses are
			shown as the sitemap records them — the production domain — but the links
			open on whichever host you are viewing this from.</xsl:text>
		</footer>
	</xsl:if>

</div>
</body>
</html>
</xsl:template>
</xsl:stylesheet>
