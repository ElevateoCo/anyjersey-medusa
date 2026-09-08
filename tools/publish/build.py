from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
body = open(HERE / 'body.html').read()
toc  = open(HERE / 'toc.html').read()

HTML = r'''<title>Leaving Shopify</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --paper:#EDEFF1; --card:#FBFCFD; --card-2:#F4F6F8;
  --ink:#141E29; --ink-2:#546374; --ink-3:#7C8B99;
  --rule:#D3DAE1; --rule-2:#E2E7EC;
  --accent:#A8761A; --accent-ink:#835C11; --accent-wash:#F3E9D3; --accent-line:#C9A15A;
  --good:#3D6A56; --good-wash:#E2EDE7;
  --risk:#9C4433; --risk-wash:#F6E4E0;
  --shadow:0 1px 2px rgba(20,30,41,.05), 0 8px 24px -16px rgba(20,30,41,.18);
  --serif:'Spectral',Georgia,'Times New Roman',serif;
  --sans:'IBM Plex Sans','Helvetica Neue',Arial,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --paper:#0E151D; --card:#151E27; --card-2:#1A242E;
    --ink:#E2E8EE; --ink-2:#94A3B1; --ink-3:#71818F;
    --rule:#26323D; --rule-2:#1F2A34;
    --accent:#D8A343; --accent-ink:#E3B968; --accent-wash:#2A2317; --accent-line:#7A6029;
    --good:#6FA98C; --good-wash:#17251F;
    --risk:#D2705E; --risk-wash:#2A1B18;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.7);
  }
}
:root[data-theme="dark"]{
  --paper:#0E151D; --card:#151E27; --card-2:#1A242E;
  --ink:#E2E8EE; --ink-2:#94A3B1; --ink-3:#71818F;
  --rule:#26323D; --rule-2:#1F2A34;
  --accent:#D8A343; --accent-ink:#E3B968; --accent-wash:#2A2317; --accent-line:#7A6029;
  --good:#6FA98C; --good-wash:#17251F;
  --risk:#D2705E; --risk-wash:#2A1B18;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.7);
}

*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto} *{animation:none!important;transition:none!important}}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--sans); font-size:16px; line-height:1.65;
  -webkit-font-smoothing:antialiased;
}
a{color:var(--ink); text-decoration:none; border-bottom:1px solid var(--accent-line)}
a:hover{color:var(--accent); border-bottom-color:var(--accent)}
:focus-visible{outline:2px solid var(--accent); outline-offset:3px; border-radius:2px}

/* ---------- masthead ---------- */
.masthead{
  border-bottom:1px solid var(--rule); background:var(--card);
  padding:clamp(2.2rem,5vw,3.6rem) clamp(1.2rem,4vw,3rem) 0;
}
.mast-inner{max-width:1240px; margin:0 auto}
.stamp{
  font-family:var(--mono); font-size:.7rem; letter-spacing:.14em; text-transform:uppercase;
  color:var(--accent-ink); display:flex; flex-wrap:wrap; gap:.9rem; align-items:center;
}
.stamp .dot{width:4px;height:4px;background:var(--accent-line);border-radius:50%}
h1{
  font-family:var(--serif); font-weight:600; letter-spacing:-.015em;
  font-size:clamp(2.4rem,6.5vw,4.1rem); line-height:1.02; text-wrap:balance;
  margin:.7rem 0 .5rem;
}
.dek{
  font-size:clamp(1.02rem,2.1vw,1.2rem); color:var(--ink-2); max-width:62ch;
  margin:0 0 1.6rem; text-wrap:pretty;
}
.meta{
  font-family:var(--mono); font-size:.75rem; color:var(--ink-3);
  display:flex; flex-wrap:wrap; gap:.4rem 1.4rem; padding-bottom:1.8rem;
  border-bottom:1px solid var(--rule-2);
}
.meta b{color:var(--ink-2); font-weight:500}

/* verdict tiles */
.verdict{
  display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
  gap:1px; background:var(--rule); border:1px solid var(--rule);
  margin:1.8rem 0 0; border-bottom:none;
}
.tile{background:var(--card); padding:1.15rem 1.25rem 1.35rem}
.tile .k{
  font-family:var(--mono); font-size:.66rem; letter-spacing:.13em; text-transform:uppercase;
  color:var(--ink-3); display:block; margin-bottom:.55rem;
}
.tile .v{
  font-family:var(--serif); font-weight:600; font-size:1.72rem; line-height:1.1;
  font-variant-numeric:tabular-nums; letter-spacing:-.01em;
}
.tile .n{display:block; font-size:.8rem; color:var(--ink-2); margin-top:.4rem; line-height:1.45}
.tile.hero{background:var(--accent-wash)}
.tile.hero .v{color:var(--accent-ink); font-size:1.34rem}

/* ---------- layout ---------- */
.wrap{max-width:1240px; margin:0 auto; padding:0 clamp(1.2rem,4vw,3rem)}
.cols{display:grid; grid-template-columns:224px minmax(0,1fr); gap:clamp(2rem,4vw,3.5rem); align-items:start}
@media (max-width:900px){.cols{grid-template-columns:minmax(0,1fr)}}

/* ---------- toc ---------- */
.toc{position:sticky; top:0; padding:2.6rem 0 3rem; max-height:100vh; overflow-y:auto}
.toc h2{
  font-family:var(--mono); font-size:.66rem; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-3); margin:0 0 .9rem; font-weight:500;
}
.toc ol{list-style:none; margin:0; padding:0; display:flex; flex-direction:column}
.toc a{
  display:grid; grid-template-columns:1.9rem 1fr; gap:.35rem; align-items:baseline;
  padding:.34rem 0; border:0; font-size:.84rem; line-height:1.35; color:var(--ink-2);
}
.toc a:hover{color:var(--ink)}
.toc .tnum{font-family:var(--mono); font-size:.7rem; color:var(--ink-3)}
.toc .tdash{color:var(--rule)}
.toc a.on{color:var(--ink); font-weight:600}
.toc a.on .tnum{color:var(--accent)}
@media (max-width:900px){
  .toc{position:static; max-height:none; padding:1.8rem 0 0; border-bottom:1px solid var(--rule)}
  .toc ol{display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:0 1.4rem}
}

/* ---------- document ---------- */
main{padding:2.6rem 0 5rem; min-width:0}
section{padding-bottom:2.8rem; margin-bottom:2.8rem; border-bottom:1px solid var(--rule-2)}
section:last-of-type{border-bottom:0}
section > *{max-width:68ch}
h2{
  font-family:var(--serif); font-weight:600; font-size:clamp(1.6rem,3.4vw,2.1rem);
  line-height:1.15; letter-spacing:-.012em; text-wrap:balance;
  margin:0 0 1.4rem; padding-bottom:.7rem; border-bottom:2px solid var(--accent-line);
  display:flex; gap:.85rem; align-items:baseline; max-width:none;
}
.secnum{
  font-family:var(--mono); font-size:.78rem; font-weight:500; color:var(--accent);
  letter-spacing:.06em; flex:none; padding-top:.42em;
}
h3{
  font-family:var(--sans); font-weight:600; font-size:1.06rem; letter-spacing:.005em;
  margin:2.4rem 0 .8rem; color:var(--ink); text-wrap:balance;
}
h3::before{
  content:''; display:block; width:22px; height:2px; background:var(--rule);
  margin-bottom:.7rem;
}
p{margin:0 0 1.05rem; text-wrap:pretty}
p.lede{
  font-family:var(--serif); font-size:1.14rem; line-height:1.55; color:var(--ink);
  border-left:2px solid var(--accent-line); padding-left:1.1rem; margin-bottom:1.4rem;
}
p.lede strong{font-weight:600}
strong{font-weight:600}
ul,ol{margin:0 0 1.15rem; padding-left:1.35rem}
li{margin-bottom:.5rem; text-wrap:pretty}
li > p{margin-bottom:.6rem}
li ul{margin-top:.5rem; margin-bottom:.6rem}
ol{counter-reset:none}
ol > li::marker{font-family:var(--mono); font-size:.85em; color:var(--accent)}
ul > li::marker{color:var(--ink-3)}

/* checklist */
ul.checklist{
  list-style:none; padding:0; margin:0 0 1.3rem; max-width:none;
  display:grid; grid-template-columns:repeat(auto-fill,minmax(268px,1fr)); gap:.1rem 1.6rem;
}
ul.checklist li{
  position:relative; padding:.32rem 0 .32rem 1.6rem; margin:0;
  font-size:.9rem; color:var(--ink-2); border-bottom:1px solid var(--rule-2);
}
ul.checklist li::before{
  content:''; position:absolute; left:0; top:.72em; width:9px; height:9px;
  border:1px solid var(--accent-line); border-radius:1px;
}

/* ---------- tables ---------- */
.table-wrap{
  overflow-x:auto; margin:0 0 1.6rem; max-width:none;
  border:1px solid var(--rule); background:var(--card);
  box-shadow:var(--shadow);
}
table{border-collapse:collapse; width:100%; font-size:.845rem; line-height:1.5}
thead th{
  position:sticky; top:0; background:var(--card-2); text-align:left; font-weight:600;
  font-family:var(--mono); font-size:.68rem; letter-spacing:.09em; text-transform:uppercase;
  color:var(--ink-2); padding:.7rem .85rem; border-bottom:1px solid var(--rule);
  white-space:nowrap;
}
tbody td{padding:.62rem .85rem; border-bottom:1px solid var(--rule-2); vertical-align:top; color:var(--ink-2)}
tbody tr:last-child td{border-bottom:0}
tbody td:first-child{color:var(--ink); font-weight:500}
tbody td.num{
  font-family:var(--mono); font-variant-numeric:tabular-nums; text-align:right;
  white-space:nowrap; color:var(--ink);
}
tbody tr:hover td{background:var(--card-2)}
tr.grouprow td{
  background:var(--accent-wash); color:var(--accent-ink); font-family:var(--mono);
  font-size:.7rem; letter-spacing:.09em; text-transform:uppercase; font-weight:500;
  padding:.5rem .85rem;
}
tr.grouprow td strong{font-weight:500}
tbody td strong{color:var(--ink)}

/* chips */
.pick{
  display:inline-block; font-family:var(--mono); font-size:.6rem; letter-spacing:.1em;
  text-transform:uppercase; padding:.16rem .42rem; border-radius:2px;
  background:var(--accent); color:var(--card); font-weight:500; vertical-align:.08em;
}
.sev{
  display:inline-block; font-family:var(--mono); font-size:.68rem; letter-spacing:.05em;
  padding:.14rem .45rem; border-radius:2px; white-space:nowrap;
}
.sev-hi{background:var(--risk-wash); color:var(--risk)}
.sev-md{background:var(--accent-wash); color:var(--accent-ink)}
.sev-lo{background:var(--good-wash); color:var(--good)}

/* ---------- code ---------- */
code{
  font-family:var(--mono); font-size:.855em; background:var(--card-2);
  padding:.1em .32em; border-radius:2px; color:var(--ink);
  border:1px solid var(--rule-2);
}
.codewrap{
  overflow-x:auto; margin:0 0 1.5rem; max-width:none;
  background:var(--card); border:1px solid var(--rule); border-left:2px solid var(--accent-line);
}
.codewrap pre{margin:0; padding:1.1rem 1.2rem}
.codewrap code{
  background:none; border:0; padding:0; font-size:.79rem; line-height:1.62;
  color:var(--ink-2); white-space:pre;
}

/* callout: a finding that overturns an earlier recommendation */
blockquote{
  margin:0 0 1.5rem; padding:1.05rem 1.25rem; max-width:none;
  background:var(--accent-wash); border-left:3px solid var(--accent);
  color:var(--ink);
}
blockquote p{margin:0 0 .7rem; font-size:.95rem; line-height:1.6}
blockquote p:last-child{margin-bottom:0}
blockquote strong{color:var(--accent-ink)}
blockquote code{background:var(--card); border-color:var(--accent-line)}

footer{
  border-top:1px solid var(--rule); background:var(--card);
  padding:2rem clamp(1.2rem,4vw,3rem);
}
footer .fi{
  max-width:1240px; margin:0 auto; font-family:var(--mono); font-size:.72rem;
  color:var(--ink-3); display:flex; flex-wrap:wrap; gap:.5rem 1.6rem;
}
</style>

<header class="masthead">
  <div class="mast-inner">
    <div class="stamp"><span>Research memo</span><span class="dot"></span><span>Roseyco &middot; new store</span><span class="dot"></span><span>21 Aug 2026</span></div>
    <h1>Leaving Shopify</h1>
    <p class="dek">What it actually takes to build and run an ecommerce store from the ground up &mdash; no Shopify, no hosted platform, Stripe as the processor &mdash; and why, at US card rates, the numbers do not justify it on cost alone.</p>
    <div class="meta">
      <span><b>Scope</b> US entity, selling to EU and UK</span>
      <span><b>Unit</b> $64.99 jersey + $4.99 shipping</span>
      <span><b>Figures verified</b> August 2026</span>
    </div>
    <div class="verdict">
      <div class="tile"><span class="k">Build cost</span><span class="v">$60&ndash;110k</span><span class="n">15&ndash;27 engineer-weeks</span></div>
      <div class="tile"><span class="k">Run cost at 10,000 orders/mo</span><span class="v">+$4,725</span><span class="n">per month <em>more</em> than Shopify, not less</span></div>
      <div class="tile"><span class="k">Personalisation break-even</span><span class="v">$0.47</span><span class="n">margin per order clears the gap; a $15 upcharge beats it 6&times;</span></div>
      <div class="tile hero"><span class="k">Verdict</span><span class="v">A revenue case, not a saving</span><span class="n">Build it for personalisation Shopify can't produce. There is no cost saving to fund it.</span></div>
    </div>
  </div>
</header>

<div class="wrap">
  <div class="cols">
    <nav class="toc" aria-label="Contents">
      <h2>Contents</h2>
      <ol>
__TOC__
      </ol>
    </nav>
    <main>
__BODY__
    </main>
  </div>
</div>

<footer>
  <div class="fi">
    <span>Source document: research.md</span>
    <span>Not legal or tax advice — confirm §7 with a Danish accountant and counsel</span>
    <span>All figures re-verify before budgeting</span>
  </div>
</footer>

<script>
(function(){
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  var map = {};
  links.forEach(function(a){ map[a.getAttribute('href').slice(1)] = a; });
  var secs = Array.prototype.slice.call(document.querySelectorAll('main section'));
  if(!('IntersectionObserver' in window) || !secs.length) return;
  var seen = {};
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){ seen[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0; });
    var best = null, bv = 0;
    Object.keys(seen).forEach(function(k){ if(seen[k] > bv){ bv = seen[k]; best = k; } });
    if(best){ links.forEach(function(a){ a.classList.remove('on'); }); if(map[best]) map[best].classList.add('on'); }
  }, {rootMargin:'-12% 0px -70% 0px', threshold:[0,.1,.5,1]});
  secs.forEach(function(s){ io.observe(s); });
})();
</script>
'''

HTML = HTML.replace('__TOC__', toc).replace('__BODY__', body)
open(ROOT / 'leaving-shopify.html','w').write(HTML)
print('written', len(HTML), 'chars')
