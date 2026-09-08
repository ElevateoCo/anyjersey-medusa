#!/usr/bin/env python3
"""Full project status report — code, APIs, integrations, infrastructure, legal, data.

    python3 tools/publish/status-report.py
    then: Chrome --headless --print-to-pdf

Successor to readiness.py (31 August edition). Same print design system, imported rather
than copied, so the two editions cannot drift apart stylistically.

Everything marked "verified" was run on the day of the build. Everything carried forward
from an earlier date says so, because the database is not running today and catalog counts
could not be re-taken.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from readiness import CSS, table, P  # noqa: E402

OUT = Path('status-report.html')
DATE = '4 September 2026'

VERIFIED = '<span class="pill done">verified</span>'
CARRIED = '<span class="pill later">carried fwd</span>'
UNRUN = '<span class="pill soon">not run</span>'


# ============================================================== masthead

MASTHEAD = f'''
<div class="stamp">
  <span>Find Any Jersey</span><span class="dot"></span>
  <span>Full status report</span><span class="dot"></span>
  <span>{DATE}</span>
</div>
<h1>Everything standing between this build and a first real order</h1>
<p class="dek">The commerce build is substantially complete, passes its suites, and has
never been deployed. This edition re-ran what could be re-run and corrects the single most
important claim in the 31 August report, which was wrong in a way that matters.</p>
<div class="meta">
  <span><b>Stack</b> Medusa 2.18.0 &middot; Next.js 16.3.2 &middot; React 19.2.8 &middot; Postgres 17</span>
  <span><b>Surface</b> 20 storefront routes &middot; 36 API routes &middot; 8 admin screens</span>
  <span><b>Tests</b> 537 re-run and green today &middot; 0 unrunnable</span>
  <span><b>Deployed</b> nowhere</span>
</div>

<div class="verdict">
  <div class="tile risk">
    <span class="k">Correction</span>
    <span class="v">1</span>
    <span class="n">The fail-closed boot guard is never called. It is dead code</span>
  </div>
  <div class="tile risk">
    <span class="k">Hard blockers</span>
    <span class="v">8</span>
    <span class="n">4 keys, R2, hosting, managed Postgres, secrets</span>
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
</div>

<div class="note risk">
  <span class="lbl">Read this first &mdash; and it reverses the last report</span>
  <p><strong>The 31 August report opened by saying production could not boot because
  Cloudflare R2 is marked critical. That is wrong, and the truth is worse.</strong>
  <code>assertConfigured()</code> &mdash; the function that is supposed to refuse a
  production start when a critical key is missing &mdash; <strong>is never called
  anywhere</strong>. Grepping the repository outside <code>node_modules</code> returns
  exactly two hits: its own definition at <code>src/integrations.ts:113</code>, and a
  mention of itself in its own doc comment.</p>
  <p>So the fail-closed rule that file spends fifteen lines documenting is not in force.
  <code>criticalInProduction: true</code> currently changes one thing: a number on the
  <code>/admin/integrations</code> dashboard. A production container will start happily
  with <strong>no Stripe Tax, no Shippo and no R2</strong>, and begin taking orders with
  tax uncalculated and no ability to buy a label.</p>
  <p>Two guards <em>are</em> real, and they are the only two: a missing
  <code>STRIPE_WEBHOOK_SECRET</code> throws from <code>medusa-config.ts:14</code>, and a
  missing <code>RESEND_API_KEY</code> throws from the Resend module constructor. Wiring
  <code>assertConfigured()</code> into boot is a one-line change and should happen before
  anything else on this list.</p>
</div>
'''


# ============================================================== 00 verification

VERIFY = '<h2><span class="num">00</span>What was actually re-run today</h2>' + '''
<p>Every suite was executed on {d}, including the integration suite against a real
Postgres 17 and Redis 7 — the Docker daemon was started for the purpose. Nothing below is
quoted from a previous run.</p>
'''.format(d=DATE) + table(
    ['Suite', 'Command', 'Result', '#Status'],
    [
        ['Backend unit', '<code>npm run test:unit</code>',
         '<strong>215 passed</strong>, 10 suites, 2.5s', VERIFIED],
        ['Backend typecheck', '<code>npx tsc --noEmit</code>',
         'Clean, no errors', VERIFIED],
        ['Storefront unit', '<code>npm test</code> (vitest)',
         '<strong>63 passed</strong>, 5 files', VERIFIED],
        ['Storefront typecheck', '<code>npm run typecheck</code>',
         'Clean, no errors', VERIFIED],
        ['Tools — parsing', '<code>python3 -m unittest discover</code>',
         '<strong>82 passed</strong>', VERIFIED],
        ['Contrast — WCAG AA', '<code>contrast_check.py</code>',
         'All colour pairs pass', VERIFIED],
        ['Accessibility self-test', '<code>a11y_selftest.py</code>',
         '24 of 24 correct — the checks can still fail', VERIFIED],
        ['Backend integration', '<code>npm run test:integration:http</code>',
         '<strong>177 passed</strong>, 12 suites, 236s against a real Postgres 17 + Redis 7',
         VERIFIED],
    ]) + '''
<div class="note good">
  <span class="lbl">On the headline number</span>
  <p>The README&rsquo;s claim of <strong>537 tests is exact</strong>, and every one of them
  passed today: 215 unit, 177 integration, 63 storefront, 82 tools. An earlier static count
  in this document put the integration figure at 174 by grepping for <code>it(</code>; three
  cases are generated rather than written out literally, so the grep undercounted and the
  README was right. The suite was run rather than counted.</p>
</div>
'''


# ============================================================== 01 front end

FRONTEND = '<h2><span class="num">01</span>Code &mdash; front end</h2>' + '''
<p>Next.js 16.3.2 on React 19.2.8. <strong>Twenty page routes</strong>, all rendering,
typecheck clean, 63 unit tests green. Stripe is wired through
<code>@stripe/react-stripe-js</code>, which is what puts the card fields on our own domain.</p>

<h3>The routes that exist</h3>
<p><code>/</code> &middot; <code>/jerseys</code> &middot; <code>/jerseys/[handle]</code> &middot;
<code>/collections/[handle]</code> &middot; <code>/cart</code> &middot; <code>/checkout</code> &middot;
<code>/order/[id]</code> &middot; <code>/track</code> &middot; <code>/request</code> &middot;
<code>/returns</code> &middot; <code>/shipping</code> &middot; <code>/size-guide</code> &middot;
<code>/contact</code> &middot; <code>/policies/[slug]</code> &middot; <code>/privacy-choices</code> &middot;
<code>/account</code> and its five sub-routes (login, register, forgot, reset, orders).</p>
''' + table(
    ['Item', 'State', '#When'],
    [
        ['Screen-reader pass',
         'The mechanical audit covers 25 pages and checks landmarks, radio grouping, live '
         'regions and the skip link. Nobody has listened to VoiceOver or NVDA work the buy '
         'box or checkout, and nobody has done a keyboard-only traversal. This is the one '
         'front-end item that cannot be automated away.', P['soon']],
        ['Size measurements',
         'The <code>MEASUREMENTS</code> table is empty, so <code>/size-guide</code> says so '
         'rather than printing a generic chart. Under a final-sale policy a wrong size is '
         'the customer&rsquo;s loss, which makes this the highest-value line in the supplier '
         'email.', P['soon']],
        ['Favicon and brand assets',
         'The default Next.js favicon is still in place; <code>public/</code> was emptied of '
         'the starter SVGs and nothing replaced them.', P['soon']],
        ['Product imagery',
         '67% of products have exactly one photograph. A deliberate decision (§13.6) with a '
         'stated cost: fit and appearance surprises drive apparel returns. Photograph the '
         'top sellers once there is order data to pick them.', P['later']],
        ['Personalisation teaser',
         'The homepage block is a placeholder. The preview itself is live on every eligible '
         'product page; a teaser that cannot lead to a finished order is not worth the space '
         'until the print-file format exists.', P['later']],
        ['Search quality',
         'Free-text search is <code>ILIKE \'%…%\'</code>, which cannot use an index. Fine at '
         '4,300 products, a real problem at 40,000 or under load.', P['later']],
    ])


# ============================================================== 02 back end

BACKEND = '<h2><span class="num">02</span>Code &mdash; back end</h2>' + '''
<p>Medusa 2.18.0. <strong>36 API route files</strong> — 17 store, 17 admin, plus health and
media — and <strong>8 admin screens</strong> built as dashboard extensions. Four custom
modules (<code>catalog</code>, <code>resend</code>, <code>tax-stripe</code>,
<code>fulfillment-shippo</code>), eleven migrations, 215 unit tests, typecheck clean.</p>

<h3>Correctness and scale</h3>
''' + table(
    ['Item', 'Detail', '#When'],
    [
        ['Boot guard not wired',
         '<code>assertConfigured()</code> is exported and never called. See page one. A '
         'one-line fix that restores the fail-closed behaviour the codebase already '
         'documents and tests around.', P['block']],
        ['Event bus and locking',
         'No Redis event-bus, locking, cache or workflow-engine module is registered in '
         '<code>medusa-config.ts</code> — setting <code>projectConfig.redisUrl</code> does '
         'not switch them. Medusa announces it at every boot: <em>"Local Event Bus '
         'installed. This is not recommended for production."</em> Jobs run in-process, so '
         'a restart loses queued work, <strong>including order confirmation emails</strong>. '
         'Redis is already running in compose; this is registration, not new code.', P['block']],
        ['Print-file generator',
         'The only genuinely blocked piece of engineering. Needs the supplier&rsquo;s '
         'required format — vector or raster, spot colours, template. The on-screen preview '
         'is independent and finished.', P['block']],
        ['In-process caches',
         'Four endpoints cache in module memory: facets, sitemap, store reviews, collections. '
         'Correct on one instance, wrong on two — and an import stays invisible until a TTL '
         'expires.', P['soon']],
        ['Refund and label execution',
         'The returns queue records decisions and deliberately does not move money or buy '
         'labels: both are irreversible external calls and Shippo&rsquo;s transaction '
         'endpoint is not idempotent. Somebody does that step by hand in Orders, or it needs '
         'building with an idempotency key.', P['soon']],
        ['Instrumentation',
         '<code>instrumentation.ts</code> is the untouched Medusa stub — every line commented '
         'out. No OpenTelemetry, no traces. The custom error reporter is separate and does '
         'work.', P['soon']],
        ['Public write endpoints',
         'Rate limiting exists as a tested module. <code>/store/jersey-requests</code> is a '
         'public POST that writes rows and needs it applied before it faces the internet.', P['soon']],
        ['Inventory',
         '<code>manage_inventory</code> is false on every variant. A decision for a sourcing '
         'model, not an oversight — but it means nothing can ever be out of stock, including '
         'things the supplier cannot get.', P['later']],
        ['Invoice PDFs',
         'Required for EU B2C sales only. A US-first launch does not need them.', P['later']],
    ]) + '''
<div class="note good">
  <span class="lbl">Worth not re-litigating</span>
  <p>Error handling is registered as <code>config.errorHandler</code> and delegates to
  Medusa&rsquo;s own handler explicitly, because <code>next(err)</code> fell through to
  Express and answered a routine 400 with a 500 HTML page containing a stack trace. Request
  ids are attached inbound and returned on every response. The Sentry reporter scrubs
  secrets by key name <em>and</em> by value shape, because either alone misses cases.</p>
</div>
'''


# ============================================================== 03 integrations

INTEG = '<h2><span class="num">03</span>APIs, keys and integrations</h2>' + '''
<p>Nine integrations are declared in <code>src/integrations.ts</code>. Five are flagged
<code>criticalInProduction</code>. Read the <em>Boot</em> column carefully: it is what
actually happens today, not what the flag claims.</p>
''' + table(
    ['Integration', 'Implementation', 'Boot behaviour today', '#When'],
    [
        ['Stripe<br><span class="k">payments</span>',
         'Medusa&rsquo;s <code>payment-stripe</code> provider. Path proven 7 of 8 steps '
         'through the Store API with no browser involved; the last step needs a test key.',
         '<strong>Throws</strong> without <code>STRIPE_WEBHOOK_SECRET</code>. Measured: with '
         'it empty the webhook returns HTTP 200 to unsigned <em>and</em> forged payloads.',
         P['block']],
        ['Resend<br><span class="k">transactional email</span>',
         'Own module. 9 templates wired to 6 triggers. Renders and logs without a key.',
         '<strong>Throws</strong> in production without <code>RESEND_API_KEY</code>. Order '
         'confirmations do not exist until it is set.',
         P['block']],
        ['Stripe Tax<br><span class="k">US nexus, EU VAT</span>',
         'Own module, tested — including that it sends cents rather than dollars, and that it '
         'distinguishes "no tax owed" from "tax not switched on". One live HTTP call untested.',
         '<strong>Starts anyway.</strong> Flagged critical, guard never runs. Off unless '
         '<code>STRIPE_TAX_ENABLED=true</code>; billing is 0.5% of volume.',
         P['block']],
        ['Shippo<br><span class="k">labels, tracking, customs</span>',
         'Own module. <strong>Rating is already live</strong> off our own rate card and needs '
         'no account. Only labels, tracking and customs documents need the key.',
         '<strong>Starts anyway.</strong> Flagged critical, guard never runs.',
         P['block']],
        ['Cloudflare R2<br><span class="k">image storage</span>',
         '<strong>No implementation at all.</strong> <code>MEDIA_BACKEND=r2</code> appears in '
         'one comment, one admin string, the compose file and the deploy template — and is '
         'read by no code. The <code>R2_*</code> variables appear only in the registry that '
         'lists them. Images are served from Postgres and work.',
         '<strong>Starts anyway.</strong> Decide: build the adapter, or set the flag to '
         '<code>false</code> and stop calling it critical.',
         P['block']],
        ['Sentry<br><span class="k">errors</span>',
         'Custom reporter over <code>fetch</code> against Sentry&rsquo;s envelope API — no SDK, '
         'deliberately, because the SDK patches http and async_hooks at import and Medusa&rsquo;s '
         'worker split is where that goes wrong. Fingerprinting and scrubbing work without a DSN.',
         'Optional. Nothing is being watched until <code>SENTRY_DSN</code> is set.',
         P['soon']],
        ['PostHog<br><span class="k">analytics</span>',
         'Consent-gated loader in the storefront: nothing loads before a positive choice and '
         'nothing loads at all under Global Privacy Control. Setting the key also adds the host '
         'to the CSP allow-list.',
         'Optional. No funnel data until the key is set.',
         P['soon']],
        ['Typesense<br><span class="k">search</span>',
         '<strong>Registered with no implementation.</strong> Search falls back to SQL '
         '<code>ILIKE</code>. A key today would do nothing.',
         'Optional.', P['later']],
        ['Omnisend<br><span class="k">marketing email</span>',
         '<strong>Registered with no implementation.</strong> Newsletter subscribers are being '
         'collected so the list exists whenever a provider is chosen.',
         'Optional.', P['later']],
    ]) + '''
<h3>The payment architecture decision, restated because it sets the compliance budget</h3>
<p>Medusa 2.18&rsquo;s Stripe provider is <strong>PaymentIntents plus Elements</strong>, not
Checkout Sessions. The research memo recommended Checkout Sessions; that path is not on
offer. The consequence is not cosmetic: the card fields are an iframe on <em>our</em> domain,
so the checkout page is in PCI scope and the assessment moves from
<strong>SAQ A to SAQ A-EP</strong> — requirements 6.4.3 (script inventory and integrity) and
11.6.1 (tamper detection) become materially heavier. The CSP has already been written for
SAQ A-EP with every entry justified and is now derived from the environment rather than
pinned to localhost.</p>
<p>The functional argument for Checkout Sessions mostly evaporates anyway, because Medusa
already owns cart, tax, discounts, shipping and addresses — which was the reason to prefer
Checkout in the first place. What is given up is Stripe-hosted conversion tuning, Link, and
Adaptive Pricing.</p>
'''


# ============================================================== 04 infrastructure

INFRA = '<h2><span class="num">04</span>Infrastructure &mdash; none of this exists</h2>' + '''
<p>This is the largest remaining block of work and the least interesting.
<code>docker-compose.yml</code> is production-<em>shaped</em> — built images, real Postgres
and Redis, health checks, no bind mounts, <code>NODE_ENV: production</code> — and has never
been run against a real environment. <code>.env.deploy</code> does not exist. Both services
have a <code>Dockerfile</code> and CI builds both images; nothing consumes them.</p>
''' + table(
    ['Need', 'Today', '#When'],
    [
        ['Hosting', 'Nothing chosen. Two containers plus Postgres and Redis.', P['block']],
        ['Managed Postgres',
         'Docker on one laptop, and the daemon was down today. Needs automated backups, '
         'point-in-time recovery and a <em>tested</em> restore drill. Restore time is the '
         'single number that should trigger moving images out of the database — 728 MB of '
         'image bytes ride along with every backup.', P['block']],
        ['Secret manager',
         '<code>.env</code> files on a laptop. Needs a real store and a rotation policy before '
         'any live key is issued.', P['block']],
        ['TLS and domain',
         'Everything is localhost. The CSP now derives from '
         '<code>NEXT_PUBLIC_MEDUSA_URL</code>, so this is configuration rather than code — '
         'but it is untested against a real origin.', P['block']],
        ['Redis wired for real',
         'Running in compose and not registered as Medusa&rsquo;s event bus, cache or lock '
         'provider. See §02.', P['block']],
        ['CI to staging',
         'CI runs six jobs on every push — tools, backend unit, backend integration against a '
         'real Postgres 17 and Redis 7, storefront, and both image builds. It deploys nothing, '
         'and there is no staging environment to deploy to.', P['soon']],
        ['Rollback',
         'Migrations are forward-only in practice; no rollback has ever been rehearsed.', P['soon']],
        ['Monitoring and on-call',
         'Nothing is watching. No uptime checks, no alerting, no log aggregation. You are the '
         'rotation.', P['soon']],
        ['CDN',
         'Images are content-addressed and served <code>immutable</code> with a one-year '
         'max-age, so they are CDN-ready — and no CDN is in front of them. Every image request '
         'currently holds a database connection and competes with checkout.', P['soon']],
        ['Node pinning',
         'Node 22.23.2 via a <code>PATH</code> export. Medusa supports 20/22 LTS only and this '
         'machine defaults to unsupported Node 25. Pinned correctly in CI and in the images; '
         'unpinned locally.', P['soon']],
    ])


# ============================================================== 05 legal

LEGAL = '<h2><span class="num">05</span>Legal and compliance</h2>' + '''
<div class="note risk">
  <span class="lbl">The four that no code can close</span>
  <p>Three gate EU revenue outright and one gates personalisation, which is the entire
  commercial argument for owning this stack. They have lead times measured in weeks, they
  cost nothing to begin, and they can all start today in parallel with everything else. The
  storefront already refuses EU addresses and names which appointment is missing, so the
  <em>build</em> is not waiting on them — the revenue is.</p>
</div>
''' + table(
    ['Requirement', 'Consequence while missing', '#When'],
    [
        ['IOSS registration + EU intermediary',
         'Import VAT on EU B2C consignments cannot be collected correctly. EU sales blocked.',
         P['block']],
        ['GDPR Article 27 EU representative',
         'Required to sell into the EU from the US. EU sales blocked.', P['block']],
        ['GPSR EU Responsible Person',
         'Without one, apparel cannot lawfully be placed on the EU market at all.', P['block']],
        ['Licensing position',
         'Unresolved. Printing a player&rsquo;s name to order raises the question more sharply '
         'than selling a stock shirt does. This gates personalisation <em>going live</em>, not '
         'being built.', P['block']],
        ['US economic nexus registrations',
         'Stripe Tax calculates; it does not register. Nexus reaches 45 states.', P['soon']],
        ['Legal review of the policies',
         'Privacy, terms, refunds and shipping are published with a visible draft banner. A '
         'refund policy is a contract term; the banner is honest, not sufficient.', P['soon']],
    ]) + '''
<h3>Trader identity — three disclosures still outstanding</h3>
<p>Eight identity fields are enumerated in one place (<code>storefront/lib/site.ts</code>)
with the legal basis for each. The policy pages call <code>pendingEntityFields()</code> and
render every unset field as a <strong>labelled gap with the reason it is required</strong>,
rather than omitting a required disclosure or inventing a value. Five are filled from the
live store&rsquo;s own published contact information. Three are empty:</p>
<ul>
  <li><strong>Registered postal address</strong> — required on the storefront and on every
  invoice. The live store publishes none either.</li>
  <li><strong>Privacy / data-subject request channel</strong> — GDPR Art. 15–22 and the US
  state privacy laws all require one.</li>
  <li><strong>A domain mailbox.</strong> Support currently resolves to a personal Gmail
  address, and the trading entity (<em>Crux Christi</em>) differs from the brand
  (<em>Find Any Jersey</em>). Both are lawful; neither is a good long-term answer.</li>
</ul>

<div class="note good">
  <span class="lbl">Already done, and worth not re-litigating</span>
  <p>Consent is opt-in with Global Privacy Control honoured silently and without a banner.
  The US state opt-out page exists with a working control. The CSP is written for PCI SAQ
  A-EP with every entry justified. Reviews carry provenance and cannot be presented as
  verified when they are not. No compare-at price, countdown or stock claim appears anywhere
  the data cannot support it. WCAG AA contrast is enforced by a script that runs in CI and
  has already caught one real 1.27:1 failure.</p>
</div>
'''


# ============================================================== 06 data

DATA = '<h2><span class="num">06</span>Data and supplier inputs</h2>' + '''
<div class="note">
  <span class="lbl">One email closes five gaps</span>
  <p>Fibre composition, country of origin, HS codes, care instructions and chest/length
  measurements. Four are regulatory and one is the highest-leverage line on the storefront
  under a final-sale policy. The <code>jersey_detail</code> table has eight regulatory
  columns and <strong>every one is null on every product</strong>.</p>
</div>
''' + table(
    ['Field', 'Coverage', 'Blocks', '#When'],
    [
        ['Fibre composition', 'none', 'EU Textile Regulation', P['block']],
        ['Country of origin', 'none', 'Customs declarations', P['block']],
        ['HS code', 'none', 'Cross-border shipping', P['block']],
        ['EU responsible person', 'none', 'GPSR — EU market entry', P['block']],
        ['Print-file format', 'unknown', 'Every queued personalisation', P['block']],
        ['Size measurements', 'none', 'Size guide, and returns we cannot accept', P['soon']],
        ['Supplier cost per personalisation', 'unknown',
         'Confirming the 55% margin assumption — not the build', P['soon']],
        ['Patch list per league', 'none',
         'The patch tier is built and offers nothing until <code>PATCHES_&lt;LEAGUE&gt;</code> '
         'is set', P['later']],
    ]) + '''
<h3>Catalog</h3>
<p>The database is not running today, so these are carried forward from the 29 August sync
and the 31 August audit rather than re-counted. What <em>was</em> re-checked is the source
data on disk, which agrees.</p>
''' + table(
    ['Measure', 'Value', '#Source'],
    [
        ['Live-store snapshot on disk', '<strong>4,318</strong> products',
         're-counted today ' + VERIFIED],
        ['Imported catalog', '4,323 products / 29,002 variants', CARRIED],
        ['Catalogue price', '<strong>$65.99 flat</strong>, every product, every region',
         'set and verified today ' + VERIFIED],
        ['Custom blanks', '<strong>111</strong>, printing included at $89.99 — 69 from the NFL '
         'snapshot plus 42 living inside the main catalog with ordinary-looking handles',
         're-counted today ' + VERIFIED],
        ['Curated collections', '11', 're-counted today ' + VERIFIED],
        ['Flagged <code>needs_review</code>', '157', CARRIED],
        ['No team resolved', '113 — excluded from the team facet until reviewed', CARRIED],
        ['Exactly one image', '67%', CARRIED],
        ['Imported reviews', '84, average 4.94 — matching the source aggregate exactly', CARRIED],
        ['&hellip; attached to a product', '17', CARRIED],
        ['In our catalog, not on the live store', '1,076 — left alone deliberately', CARRIED],
    ]) + '''
<div class="note good">
  <span class="lbl">Pricing, set 4 September</span>
  <p>The catalog now carries <strong>one price: $65.99 USD</strong> — 4,212 products and
  28,221 variants, identical in all five regions. It replaced a spread of $30&ndash;$119.99.
  All five regions were already <code>usd</code> with no price lists and no currency
  conversion, so the same number is what a shopper sees in Sydney and in Ohio; only shipping
  and tax vary by destination.</p>
  <p>Two things were deliberately left alone: the <strong>111 custom blanks at $89.99</strong>,
  which ship with the name and number included, and the <strong>personalisation add-ons</strong>
  ($9.99 number, $14.99 name, $19.99 bundle, $7.99 patch). Pricing a blank the same as a plain
  shirt would have made the bundle unsellable.</p>
</div>

<p>The <code>needs_review</code> flags are mostly unresolvable ambiguity rather than error:
"Los Angeles Basketball" is the Lakers or the Clippers, and a wrong team is worse than a
missing one. The 67 reviews that did not attach name no product, or name a shirt we no
longer stock — there is no more per-product data in existence, so this is not a migration
failure to go back and fix.</p>
'''


# ============================================================== 07 order

ORDER = '<h2><span class="num">07</span>The order to do it in</h2>' + '''
<p>Grouped by what unblocks what, not by size. Nothing in the first group takes long, and
nothing in the later groups can start without it.</p>

<h3>This week — costs nothing, unblocks everything</h3>
<ol>
  <li><strong>Wire <code>assertConfigured()</code> into boot</strong> and re-check every
  <code>criticalInProduction</code> flag against what is actually implemented. R2 is flagged
  critical and does not exist; either build the adapter or set the flag to
  <code>false</code>. One line, and it decides whether the next fifteen items are guarded or
  merely documented.</li>
  <li><strong>Start the four legal appointments.</strong> IOSS and an EU intermediary, the
  Article 27 representative, the GPSR responsible person, and a licensing opinion. Weeks of
  lead time, nothing to build, nothing to wait for.</li>
  <li><strong>Send the supplier email.</strong> Five gaps, one message: fibre composition,
  country of origin, HS codes, care instructions, chest and length measurements — plus the
  print-file format and the per-personalisation cost.</li>
  <li><strong>Register Redis</strong> as Medusa&rsquo;s event bus, cache and lock provider.
  It is already running; this is configuration.</li>
</ol>

<h3>Next — the deployment block</h3>
<ol start="5">
  <li>Choose hosting and stand up managed Postgres with automated backups. <strong>Run a
  restore drill and time it</strong> — that number decides whether images stay in the
  database.</li>
  <li>Stand up a secret manager. No live key touches a laptop.</li>
  <li>Domain, TLS, and the first real origin. Verify the derived CSP against it.</li>
  <li>Issue the four blocking keys: Stripe live plus webhook secret, Resend, Stripe Tax,
  Shippo. Finish the eighth step of the payment path first, in test mode.</li>
  <li>Extend CI to deploy to staging. Rehearse one rollback before you need one.</li>
  <li>Uptime checks, alerting, log aggregation, and a Sentry DSN.</li>
</ol>

<h3>Before the first real order</h3>
<ol start="11">
  <li>Screen-reader pass and keyboard traversal, by a human.</li>
  <li>Legal review of the four policy pages; fill the three outstanding trader fields.</li>
  <li>Rate-limit the public write endpoints.</li>
  <li>Move the four in-process caches to Redis, or accept a single instance and say so.</li>
  <li>Decide the refund and label execution path: by hand in Orders, or built with an
  idempotency key.</li>
  <li>US nexus registrations, starting with the home state.</li>
</ol>
'''


# ============================================================== 08 decisions

RISKS = '<h2><span class="num">08</span>Three things to decide, not just do</h2>' + '''
<h3>1. The fail-closed design was never switched on</h3>
<p>This is worth more than the one-line fix. The codebase argues carefully, in comments and
in tests, that a silently disabled integration is worse than a container that refuses to
start — and then never calls the function that enforces it. Two module constructors happen
to guard themselves, which is why the gap was invisible: boot <em>does</em> fail without
Stripe or Resend, so it looks like the system works. It does not. Decide whether the rule is
real, and if it is, make the flag mean something.</p>

<h3>2. R2 is a five-minute decision that has been open for a week</h3>
<p>Images in Postgres genuinely work, and the reasoning behind them is sound: WebP at q78
capped at 1400px is about 410 MB rather than 3.09 GB, one canonical asset with derivatives
rendered on request, content-addressed and served immutable. The stated trigger for moving
them out was restore time. Nobody has run a restore, so nobody has that number. Either
accept Postgres and drop the R2 flag, or build the adapter — but stop carrying a critical
dependency that no code reads.</p>

<h3>3. The business case still rests on personalisation, and personalisation is gated on licensing</h3>
<p>Cost never justified leaving Shopify; capability did, and the capability is
name-and-number personalisation. That module is built, tested with 45 unit cases, and
priced through the pricing engine rather than the browser. It is blocked on two things
neither of which is engineering: the supplier&rsquo;s print-file format, and a licensing
position on printing a player&rsquo;s name to order. Two personalisations are already queued
in the database and nothing can print them.</p>

<div class="note">
  <span class="lbl">Where this stands overall</span>
  <p>The interesting work is done. What remains is one unwired guard, a deployment that has
  never happened, four appointments with lead times, one supplier email, and a human
  listening to a screen reader. None of it is hard. All of it is sequential, and the first
  four items on the list cost nothing and can start today.</p>
</div>
'''


# ============================================================== assemble

HTML = f'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Find Any Jersey — full status report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>{CSS}
.tile .k{{margin-bottom:.3rem}}
td .k{{font-family:var(--mono); font-size:6.2pt; letter-spacing:.1em;
  text-transform:uppercase; color:var(--ink-3)}}
th .k{{font-family:var(--mono); font-size:6.2pt; letter-spacing:.1em;
  text-transform:uppercase; color:var(--ink-3); font-weight:400}}
tbody th{{white-space:normal}}
</style>
</head><body><div class="wrap">
{MASTHEAD}
{VERIFY}
{FRONTEND}
{BACKEND}
{INTEG}
{INFRA}
{LEGAL}
{DATA}
{ORDER}
{RISKS}
<footer>
  Find Any Jersey / Crux Christi &middot; full status report &middot; {DATE} &middot;
  compiled from the repository at spike/ &mdash; suites re-run on the day, catalog counts
  carried forward and marked as such.
</footer>
</div></body></html>
'''

if __name__ == '__main__':
    OUT.write_text(HTML)
    print(f'wrote {OUT} ({len(HTML):,} bytes)')
