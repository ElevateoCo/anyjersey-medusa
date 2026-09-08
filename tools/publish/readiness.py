#!/usr/bin/env python3
"""Render the production-readiness summary to a print-ready HTML file.

    python3 tools/publish/readiness.py            # writes production-readiness.html
    then: Chrome --headless --print-to-pdf

Kept as a script rather than hand-written HTML for the same reason `build.py` is: the
document is long, the styling is shared with `leaving-shopify.html`, and the content is
easier to review as data than as markup.

Print-first, unlike build.py: A4, no dark mode, no sticky navigation, page breaks controlled
so a table never splits across a page and no heading is orphaned at the foot of one.
"""
import io
from pathlib import Path
from html import escape

OUT = Path('production-readiness.html')

CSS = r'''
:root{
  --paper:#FFFFFF; --card:#FBFCFD; --card-2:#F4F6F8;
  --ink:#141E29; --ink-2:#546374; --ink-3:#7C8B99;
  --rule:#D3DAE1; --rule-2:#E6EAEF;
  --accent:#A8761A; --accent-ink:#835C11; --accent-wash:#F7F0E0; --accent-line:#C9A15A;
  --good:#3D6A56; --good-wash:#E8F0EB;
  --risk:#9C4433; --risk-wash:#F8EAE6;
  --warn:#8A6A14; --warn-wash:#FBF3DF;
  --serif:'Spectral',Georgia,'Times New Roman',serif;
  --sans:'IBM Plex Sans','Helvetica Neue',Arial,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;
}
@page{ size:A4; margin:15mm 14mm 16mm; }
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:#fff; color:var(--ink);
  font-family:var(--sans); font-size:9.6pt; line-height:1.5;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:186mm; margin:0 auto}

/* ---------- masthead ---------- */
.stamp{
  font-family:var(--mono); font-size:6.6pt; letter-spacing:.14em; text-transform:uppercase;
  color:var(--accent-ink); display:flex; gap:.8rem; align-items:center; flex-wrap:wrap;
}
.stamp .dot{width:3px;height:3px;background:var(--accent-line);border-radius:50%}
h1{
  font-family:var(--serif); font-weight:600; letter-spacing:-.015em;
  font-size:27pt; line-height:1.03; margin:.45rem 0 .35rem;
}
.dek{font-size:11pt; color:var(--ink-2); max-width:64ch; margin:0 0 .9rem}
.meta{
  font-family:var(--mono); font-size:7pt; color:var(--ink-3);
  display:flex; flex-wrap:wrap; gap:.25rem 1.3rem;
  padding-bottom:.7rem; border-bottom:1px solid var(--rule);
}
.meta b{color:var(--ink-2); font-weight:500}

/* ---------- verdict tiles ---------- */
.verdict{
  display:grid; grid-template-columns:repeat(4,1fr);
  gap:1px; background:var(--rule); border:1px solid var(--rule);
  margin:.9rem 0 1.4rem;
}
.tile{background:var(--card); padding:.6rem .7rem .7rem}
.tile .k{
  font-family:var(--mono); font-size:6.2pt; letter-spacing:.13em; text-transform:uppercase;
  color:var(--ink-3); display:block; margin-bottom:.3rem;
}
.tile .v{font-family:var(--serif); font-size:15pt; font-weight:600; line-height:1.05;
  display:block; margin-bottom:.15rem}
.tile .n{font-size:7.4pt; color:var(--ink-2); line-height:1.35; display:block}
.tile.risk .v{color:var(--risk)} .tile.good .v{color:var(--good)}
.tile.warn .v{color:var(--warn)}

/* ---------- structure ---------- */
h2{
  font-family:var(--serif); font-size:15.5pt; font-weight:600; letter-spacing:-.01em;
  margin:1.5rem 0 .1rem; padding-top:.7rem; border-top:2px solid var(--ink);
  break-after:avoid; break-inside:avoid;
}
h2 .num{font-family:var(--mono); font-size:7.4pt; color:var(--accent-ink);
  letter-spacing:.12em; display:block; margin-bottom:.25rem; font-weight:500}
h3{
  font-family:var(--sans); font-size:10pt; font-weight:600; margin:1rem 0 .3rem;
  break-after:avoid;
}
h4{font-family:var(--mono); font-size:7.2pt; letter-spacing:.1em; text-transform:uppercase;
  color:var(--ink-3); margin:.9rem 0 .35rem; font-weight:500; break-after:avoid}
p{margin:0 0 .55rem; max-width:74ch}
ul,ol{margin:.2rem 0 .7rem; padding-left:1.1rem}
li{margin-bottom:.22rem; max-width:72ch}
strong{font-weight:600}
code{font-family:var(--mono); font-size:8.4pt; background:var(--card-2);
  padding:.05rem .2rem; border-radius:2px}
a{color:var(--ink); text-decoration:none; border-bottom:1px solid var(--accent-line)}

/* ---------- tables ---------- */
/* Tables break across pages; rows do not.
   `break-inside:avoid` on the table itself was the first attempt and it moved every table
   wholesale to the next page, leaving three pages 40-50% empty. Keeping rows atomic and
   repeating the header is what a long table actually needs in print. */
table{width:100%; border-collapse:collapse; margin:.45rem 0 .9rem; font-size:8.6pt;
  break-inside:auto}
thead{display:table-header-group}
tr{break-inside:avoid}
thead th{
  font-family:var(--mono); font-size:6.6pt; letter-spacing:.1em; text-transform:uppercase;
  color:var(--ink-3); text-align:left; font-weight:500;
  border-bottom:1px solid var(--ink); padding:.3rem .45rem .28rem;
}
tbody td,tbody th{padding:.32rem .45rem; border-bottom:1px solid var(--rule-2);
  vertical-align:top; text-align:left}
tbody th{font-weight:600; white-space:nowrap}
tbody tr:last-child td,tbody tr:last-child th{border-bottom:1px solid var(--rule)}
td.num,th.num{font-family:var(--mono); white-space:nowrap}
.pill{
  font-family:var(--mono); font-size:6.4pt; letter-spacing:.06em; text-transform:uppercase;
  padding:.1rem .3rem; border-radius:2px; white-space:nowrap; font-weight:500;
}
.pill.block{background:var(--risk-wash); color:var(--risk)}
.pill.soon{background:var(--warn-wash); color:var(--warn)}
.pill.done{background:var(--good-wash); color:var(--good)}
.pill.later{background:var(--card-2); color:var(--ink-3)}

/* ---------- callouts ---------- */
.note{
  border-left:2.5px solid var(--accent-line); background:var(--accent-wash);
  padding:.5rem .7rem; margin:.6rem 0 .9rem; font-size:8.8pt; break-inside:avoid;
  max-width:76ch;
}
.note.risk{border-left-color:var(--risk); background:var(--risk-wash)}
.note.good{border-left-color:var(--good); background:var(--good-wash)}
.note p:last-child{margin-bottom:0}
.note .lbl{
  font-family:var(--mono); font-size:6.4pt; letter-spacing:.12em; text-transform:uppercase;
  color:var(--ink-3); display:block; margin-bottom:.2rem;
}

/* ---------- page control ---------- */
.pagebreak{break-before:page}
.keep{break-inside:avoid}
footer{
  margin-top:1.6rem; padding-top:.6rem; border-top:1px solid var(--rule);
  font-family:var(--mono); font-size:6.8pt; color:var(--ink-3);
}
'''


def table(headers, rows, cls=''):
    h = ''.join(f'<th{" class=num" if str(x).startswith("#") else ""}>{escape(str(x).lstrip("#"))}</th>'
                for x in headers)
    body = ''
    for r in rows:
        cells = ''
        for i, c in enumerate(r):
            tag = 'th' if i == 0 else 'td'
            cells += f'<{tag}>{c}</{tag}>'
        body += f'<tr>{cells}</tr>'
    return (f'<table class="{cls}"><thead><tr>{h}</tr></thead>'
            f'<tbody>{body}</tbody></table>')


P = {
    'block': '<span class="pill block">blocker</span>',
    'soon':  '<span class="pill soon">before launch</span>',
    'later': '<span class="pill later">after launch</span>',
    'done':  '<span class="pill done">done</span>',
}


# ============================================================== the document

MASTHEAD = f'''
<div class="stamp">
  <span>Find Any Jersey</span><span class="dot"></span>
  <span>Production readiness</span><span class="dot"></span>
  <span>31 August 2026</span>
</div>
<h1>What is left before this can take real money</h1>
<p class="dek">The commerce build is substantially complete and has never been deployed.
Everything below is either a key, a piece of infrastructure, a supplier email, or a legal
appointment — and four of those are hard gates that no amount of engineering removes.</p>
<div class="meta">
  <span><b>Stack</b> Medusa 2.18 + Next.js 16 + Postgres 17</span>
  <span><b>Catalog</b> 4,323 products / 29,002 variants</span>
  <span><b>Tests</b> 537 passing</span>
  <span><b>Deployed</b> nowhere</span>
</div>

<div class="verdict">
  <div class="tile risk">
    <span class="k">Hard blockers</span>
    <span class="v">9</span>
    <span class="n">5 API keys, R2, hosting, and the payment path&rsquo;s last step</span>
  </div>
  <div class="tile risk">
    <span class="k">Cannot be coded</span>
    <span class="v">4</span>
    <span class="n">IOSS, GDPR Art. 27, GPSR person, licensing. Start today</span>
  </div>
  <div class="tile warn">
    <span class="k">One supplier email</span>
    <span class="v">5 gaps</span>
    <span class="n">Fibre, origin, HS codes, measurements, print format</span>
  </div>
  <div class="tile good">
    <span class="k">Built and tested</span>
    <span class="v">Most of it</span>
    <span class="n">Checkout, returns, accounts, tax, fulfilment, personalisation</span>
  </div>
</div>

<div class="note risk">
  <span class="lbl">Read this first</span>
  <p><strong>The application currently cannot boot in production, and filling in the
  configuration it asks for will not fix it.</strong> Cloudflare R2 is marked
  <code>criticalInProduction</code>, so <code>assertConfigured()</code> throws at start-up
  while its keys are empty &mdash; but no code anywhere reads them, and
  <code>MEDIA_BACKEND=r2</code> exists only in two comments. Images are served from Postgres
  and work. This is a five-minute decision (build the adapter, or set the flag to
  <code>false</code>) standing in front of every other deployment task.</p>
</div>
'''

FRONTEND = '<h2><span class="num">01</span>Front end</h2>' + '''
<p>Twenty routes, all rendering, 0 mechanical accessibility issues across 25 audited pages,
WCAG AA contrast verified by script in CI. What remains is small and mostly not code.</p>
''' + table(
    ['Item', 'Why it matters', '#When'],
    [
        ['Product imagery',
         '67% of products have exactly one photograph. §13.6 accepted that deliberately and '
         'named the cost: fit and appearance surprises drive apparel returns, and under a '
         'final-sale policy the customer absorbs that rather than us. Photograph the top '
         'sellers once there is order data.',
         P['later']],
        ['Screen-reader pass',
         'The mechanical audit covers 25 pages and now checks landmark naming, radio '
         'grouping, live regions and the skip link. Nobody has listened to VoiceOver or '
         'NVDA work the buy box and checkout, and nobody has done a keyboard-only traversal.',
         P['soon']],
        ['Size measurements',
         '<code>MEASUREMENTS</code> is empty, so <code>/size-guide</code> says so rather '
         'than printing a generic chart. Under final sale a wrong size is the customer&rsquo;s '
         'loss, which makes this the highest-value line in the supplier email.',
         P['soon']],
        ['Personalisation teaser',
         'The homepage block is still a placeholder. The preview itself is live on every '
         'product page; a teaser that cannot lead to a finished order is not worth the space '
         'until the print-file format exists.',
         P['later']],
        ['Search quality',
         'Free-text search is <code>ILIKE \'%…%\'</code>, which cannot use an index. Fine at '
         '4,300 products and a real problem at 40,000 or under load. Typesense is registered '
         'and has no implementation behind it.',
         P['later']],
        ['Favicon and brand assets',
         'The default Next.js favicon is still in place. <code>public/</code> was emptied of '
         'the starter SVGs; nothing replaced them.',
         P['soon']],
    ])

BACKEND = '<h2><span class="num">02</span>Back end</h2>' + '''
<h3>Keys — five of nine integrations block a production boot</h3>
<p>Every module behind these is written and tested. The rule in <code>src/integrations.ts</code>
is that a missing key degrades visibly outside production and refuses to start inside it, so
each row below is a hard stop rather than a degraded feature.</p>
''' + table(
    ['Integration', 'State', '#When'],
    [
        ['Stripe',
         'Payment path proven 7 of 8 steps; the last needs a test key. <strong>With '
         '<code>STRIPE_WEBHOOK_SECRET</code> empty the webhook endpoint returns HTTP 200 to '
         'unsigned payloads</strong> &mdash; measured, not assumed. Must be set before this '
         'is reachable from the internet.',
         P['block']],
        ['Resend', '9 templates, all wired. Nothing sends without the key, and '
                   'order confirmations do not exist until it is set.', P['block']],
        ['Stripe Tax', 'Module written and tested, including that it sends cents rather than '
                       'dollars. Distinguishes &ldquo;no tax owed&rdquo; from &ldquo;tax not '
                       'switched on&rdquo;. One HTTP call to Stripe is untested.', P['block']],
        ['Shippo', 'Rating is already live off our own rate card. Only labels, tracking and '
                   'customs documents need the key.', P['block']],
        ['Cloudflare R2', '<strong>Marked critical and not implemented.</strong> See the note '
                          'on page 1. Either build the adapter or stop marking it critical.',
         P['block']],
        ['Sentry', 'Custom reporter, no SDK. Fingerprinting and scrubbing already work '
                   'without a DSN; nothing is being watched until it is set.', P['soon']],
        ['PostHog', 'Consent-gated loader written. No funnel data until the key is set.',
         P['soon']],
        ['Typesense', 'Registered with <strong>no implementation</strong>. A key would do '
                      'nothing.', P['later']],
        ['Omnisend', 'Registered with <strong>no implementation</strong>. Subscribers are '
                     'being collected so the list exists when one is chosen.', P['later']],
    ])


BACKEND += '''
<h3>Correctness and scale</h3>
''' + table(
    ['Item', 'Detail', '#When'],
    [
        ['Event bus and locking',
         'Medusa says it at every boot: <em>&ldquo;Local Event Bus installed. This is not '
         'recommended for production&rdquo;</em>, and locking is in-memory. Jobs run '
         'in-process, so a restart loses queued work &mdash; including order confirmation '
         'emails. Redis is already running and is the fix.',
         P['block']],
        ['In-process caches',
         'Four endpoints cache in module memory: facets, sitemap, store reviews, collections. '
         'Two app instances will disagree with each other, and an import is invisible until '
         'a TTL expires. Correct on one instance, wrong on two.',
         P['soon']],
        ['Inventory',
         '<code>manage_inventory</code> is false on all 29,002 variants. That is a decision '
         'for a sourcing model, not an oversight &mdash; but it means nothing can ever be '
         'out of stock, including things the supplier cannot get.',
         P['later']],
        ['Print-file generator',
         'The only genuinely blocked piece of engineering. Needs the supplier&rsquo;s required '
         'format &mdash; vector or raster, spot colours, template. The on-screen preview is '
         'independent and finished. <strong>Two personalisations are already queued and '
         'nothing can print them.</strong>',
         P['block']],
        ['Invoice PDFs',
         'Required for EU B2C sales only. A US-first launch does not need them.',
         P['later']],
        ['Refund and label execution',
         'The returns queue records decisions and deliberately does not move money or buy '
         'labels: both are irreversible external calls and Shippo&rsquo;s transaction '
         'endpoint is not idempotent. Somebody has to do that step in Orders, or it needs '
         'building with an idempotency key.',
         P['soon']],
    ])

INFRA = '<h2><span class="num">03</span>Infrastructure &mdash; none of this exists yet</h2>' + '''
<p>This is the largest remaining block of work and the least interesting. Nothing has ever
been deployed; <code>docker-compose.yml</code> is production-<em>shaped</em> (built images,
health checks, no bind mounts) and has never been run against a real environment.
<code>.env.deploy</code> does not exist.</p>
''' + table(
    ['Need', 'Today', '#When'],
    [
        ['Hosting', 'Nothing chosen. Two containers plus Postgres and Redis.', P['block']],
        ['Managed Postgres',
         'Docker on one laptop. Needs automated backups, point-in-time recovery, and a '
         '<strong>tested</strong> restore drill &mdash; the single number that should trigger '
         'moving images out of the database is how long a restore takes, and 728 MB of image '
         'bytes ride along with every one.',
         P['block']],
        ['Secret manager',
         '<code>.env</code> files on a laptop. Needs a real store and a rotation policy '
         'before any live key exists.',
         P['block']],
        ['TLS and domain',
         'Everything is localhost. The CSP is now derived from '
         '<code>NEXT_PUBLIC_MEDUSA_URL</code> rather than hardcoded, so this is '
         'configuration rather than code &mdash; but it is untested against a real origin.',
         P['block']],
        ['CI to staging',
         'CI runs every suite on push and builds both images. It deploys nothing, and there '
         'is no staging environment to deploy to.',
         P['soon']],
        ['Rollback',
         'Migrations are forward-only in practice and no rollback has been rehearsed.',
         P['soon']],
        ['Monitoring and on-call',
         'Nothing is watching. No uptime checks, no alerting, no log aggregation. You are the '
         'rotation.',
         P['soon']],
        ['CDN',
         'Images are content-addressed and served <code>immutable</code> with a one-year '
         'max-age, so they are CDN-ready and no CDN is in front of them. Every image request '
         'currently holds a database connection and competes with checkout.',
         P['soon']],
    ])


LEGAL = '<h2><span class="num">04</span>Legal and compliance &mdash; not engineering</h2>' + '''
<div class="note risk">
  <span class="lbl">The four that no code can close</span>
  <p>Three of these gate EU revenue outright and one gates personalisation, which is the
  entire commercial argument for owning this stack (§9.6). <strong>They have lead times and
  can all be started today, in parallel with everything else on this list.</strong> The
  storefront already refuses EU addresses and names which appointment is missing, so the
  build is not waiting on them &mdash; the revenue is.</p>
</div>
''' + table(
    ['Requirement', 'Consequence while missing', '#When'],
    [
        ['IOSS registration + EU intermediary',
         'Import VAT on EU B2C consignments cannot be collected correctly. EU sales blocked.',
         P['block']],
        ['GDPR Article 27 EU representative',
         'Required to sell into the EU from the US. EU sales blocked.',
         P['block']],
        ['GPSR EU Responsible Person',
         '<strong>Without one, apparel cannot lawfully be placed on the EU market at all.</strong>',
         P['block']],
        ['Licensing position',
         'Unresolved, and printing a player&rsquo;s name to order raises it more sharply than '
         'selling a stock shirt does. This gates personalisation going live, not being built.',
         P['block']],
        ['US economic nexus registrations',
         'Stripe Tax calculates, it does not register. Nexus reaches 45 states.',
         P['soon']],
        ['Legal review of the policies',
         'Privacy, terms, refunds and shipping are published with a visible draft banner. A '
         'refund policy is a contract term; the banner is honest, not sufficient.',
         P['soon']],
    ]) + '''
<h3>Trader details still outstanding</h3>
<p>The policy pages render each missing field as a labelled gap with the reason it is
required, rather than omitting the disclosure. Three remain:</p>
<ul>
  <li><strong>Registered postal address</strong> &mdash; required on the storefront and on
      every invoice. The live store publishes none either.</li>
  <li><strong>Privacy / data-subject request channel</strong> &mdash; GDPR Art. 15&ndash;22
      and the US state laws all require one.</li>
  <li><strong>A domain mailbox.</strong> Support currently resolves to a personal Gmail
      address, and the trade name (<em>Crux Christi</em>) differs from the brand
      (<em>Find Any Jersey</em>). Both are lawful and neither is a good long-term answer.</li>
</ul>

<h3>Already done, and worth not re-litigating</h3>
<p>Consent is opt-in with Global Privacy Control honoured silently and automatically; the
US state opt-out page exists with a working control; CSP is written for PCI SAQ A-EP with
every entry justified; reviews carry provenance and cannot be presented as verified when they
are not; no compare-at price, countdown or stock claim appears anywhere that the data cannot
support.</p>
'''

DATA = '<h2><span class="num">05</span>Data and supplier inputs</h2>' + '''
<div class="note">
  <span class="lbl">One email closes five gaps</span>
  <p>Fibre composition, country of origin, HS codes, care instructions and chest/length
  measurements. Four of those are regulatory and one is the highest-leverage line on the
  storefront under a final-sale policy. <strong>All 4,323 products have every regulatory
  column empty.</strong></p>
</div>
''' + table(
    ['Field', 'Coverage', 'Blocks', '#When'],
    [
        ['Fibre composition', '0 of 4,323', 'EU Textile Regulation', P['block']],
        ['Country of origin', '0 of 4,323', 'Customs declarations', P['block']],
        ['HS code', '0 of 4,323', 'Cross-border shipping', P['block']],
        ['EU responsible person', '0 of 4,323', 'GPSR &mdash; EU market entry', P['block']],
        ['Size measurements', 'none', 'Size guide, and returns we cannot accept', P['soon']],
        ['Print-file format', 'unknown', 'Every queued personalisation', P['block']],
    ]) + '''
<h3>Catalog quality</h3>
''' + table(
    ['Measure', '#Value', 'Note'],
    [
        ['Published products', '4,323', 'Synced against the live store on 29 August'],
        ['Flagged <code>needs_review</code>', '157',
         'Mostly unresolvable ambiguity, not error &mdash; &ldquo;Los Angeles Basketball&rdquo; '
         'is the Lakers or the Clippers, and a wrong team is worse than a missing one'],
        ['No team resolved', '113', 'Excluded from the team facet until reviewed'],
        ['Exactly one image', '67%', 'A decision (§13.6), with a stated cost'],
        ['Custom blanks', '69', 'Printing included at $89.99'],
        ['Imported reviews', '84', 'Average 4.94, matching the source aggregate exactly'],
        ['&hellip; attached to a product', '17',
         'The rest name no product or one we no longer stock. Not a migration failure &mdash; '
         'there is no more per-product data in existence'],
        ['In our catalog, not on the live store', '1,076',
         'Left alone deliberately. A delisted product is not necessarily unsellable on a '
         'sourcing model'],
    ])


ORDER = '<h2><span class="num">06</span>The order to do it in</h2>' + '''
<p>Grouped by what unblocks what, not by size. Nothing in the first group takes long, and
nothing in the later groups can start without it.</p>

<h4>Day one — costs nothing, unblocks everything</h4>
<ol>
  <li><strong>Decide R2.</strong> Build the adapter, or set
      <code>criticalInProduction: false</code>. Until then production cannot start.</li>
  <li><strong>Start the four legal appointments.</strong> IOSS, Article 27, GPSR responsible
      person, and a licensing opinion. These have lead times measured in weeks and cost
      nothing to begin.</li>
  <li><strong>Send the supplier email.</strong> Five gaps, one message.</li>
  <li><strong>Get a domain mailbox</strong> and a registered address into the config.</li>
</ol>

<h4>Then — the keys, in this order</h4>
<ol>
  <li><strong>Stripe test keys</strong> and <code>stripe listen</code>. Finishes step 8 of the
      payment path and lets the whole funnel be exercised end to end for the first time.</li>
  <li><strong>Resend.</strong> Order confirmations do not exist until this is set.</li>
  <li><strong>Shippo</strong> for labels and tracking; <strong>Stripe Tax</strong> switched on
      and verified against a real account.</li>
</ol>

<h4>Then — infrastructure, before any live key</h4>
<ol>
  <li>Hosting, managed Postgres, Redis for the event bus and locking.</li>
  <li>Secret manager. <strong>No live key should ever touch a laptop.</strong></li>
  <li>A restore drill that actually restores. Then decide whether 728 MB of image bytes stay
      in the database, using the restore time as the number.</li>
  <li>Staging, then CI deploying to it, then a rehearsed rollback.</li>
  <li>Sentry, uptime checks, log aggregation.</li>
</ol>

<h4>Before the first real customer</h4>
<ol>
  <li>Legal review of the four published policy documents.</li>
  <li>Screen-reader and keyboard pass.</li>
  <li>A test order through the real Stripe account, with a real label bought and a real
      refund issued.</li>
  <li>Decide who staffs the personalisation and returns queues, and what the turnaround
      target is. Both exist and neither has an owner.</li>
</ol>

<div class="note good">
  <span class="lbl">Not on this list, because it is finished</span>
  <p>Checkout and cart, discount codes, five shipping regions with a real rate card, tax
  calculation, fulfilment rating, customer accounts with password reset, self-service returns
  with an admin queue, personalisation with a live preview and a human review gate, 4,323
  products with 6,437 images in Postgres, 11 curated collections, SEO with a 4,527-URL
  sitemap and structured data, consent and privacy controls, eight admin screens, and 537
  tests that run in CI on every push.</p>
</div>
'''

RISKS = '<h2><span class="num">07</span>Three things worth deciding, not just doing</h2>' + '''
<h3>The business case has not changed shape</h3>
<p><code>research.md</code> §1 is unambiguous: on cost alone this is a losing trade. At
10,000 orders/month the own stack runs roughly <strong>$4,725/month more expensive</strong>
than Shopify, and the entire justification rests on personalisation revenue &mdash; which
needs only <strong>$0.47 of margin per order</strong> to clear that bar. The live store has
since validated the price point independently: it sells custom blanks at $89.99 against a
$64.99 base, a $25 uplift that brackets the $19.99 bundle the spec proposed as a guess.</p>
<p><strong>That makes the print-file format and the licensing opinion the two most valuable
open items on this entire document</strong>, and neither is engineering.</p>

<h3>Negotiate Stripe before committing</h3>
<p>§1 calls this the single cheapest thing on the list. Interchange-plus pricing above
meaningful volume is the only lever that closes the processing gap, and it is worth asking
for before the build is sunk rather than after.</p>

<h3>The returns policy reversed, and it was the right call</h3>
<p>§12.4 recommended free size exchange as the category&rsquo;s answer to a money-back
guarantee. The live store publishes <em>&ldquo;all sales are final&rdquo;</em>, and the code
now follows the published policy because a checkout promising one thing and a policy page
saying another is worse than either. One constant reverses it. <strong>But under final sale,
the missing size measurements stop being a data-quality gap and become the customer&rsquo;s
loss</strong> &mdash; which is why that supplier email matters more than its position on a
list of five fields suggests.</p>
'''

HTML = f'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Find Any Jersey — production readiness</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>{CSS}</style>
</head><body><div class="wrap">
{MASTHEAD}
{FRONTEND}
{BACKEND}
{INFRA}
{LEGAL}
{DATA}
{ORDER}
{RISKS}
<footer>
  Find Any Jersey / Crux Christi &middot; production readiness &middot; 31 August 2026 &middot;
  compiled from the repository at spike/ &mdash; every figure measured, not estimated.
</footer>
</div></body></html>
'''

if __name__ == '__main__':
    OUT.write_text(HTML)
    print(f'wrote {OUT} ({len(HTML):,} bytes)')
