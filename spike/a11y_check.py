#!/usr/bin/env python3
"""Static accessibility check over the rendered storefront.

    python3 spike/a11y_check.py [cart_id]

Catches the mechanical failures that are cheap to regress on: missing alt text, unlabelled
controls, heading-order jumps, duplicate ids, links whose only content is an icon — plus a
second group added later, which is about what a screen reader *announces* rather than
whether the markup parses:

  - **repeated landmarks need names.** Two <nav>s with no accessible name are announced as
    "navigation, navigation" and the listener cannot tell the site menu from a filter list.
  - **grouped radios need a <fieldset> with a <legend>.** Without it each option is read
    with no indication of what question it answers.
  - **a <select> that changes state needs its change announced.** The region picker moves
    prices with no visible page transition, so a live region is the only signal.
  - **the skip link must be first and must point at something that exists.**

Contrast is checked separately and mechanically by `contrast_check.py`.

Still genuinely outstanding, and not automatable here: listening to a real screen reader
(VoiceOver/NVDA) work the buy box and the checkout, and a keyboard-only traversal by hand.
This narrows what that pass has to look for; it does not replace it.
"""
import re, sys, urllib.request
from html.parser import HTMLParser

BASE = 'http://localhost:3000'
CART = sys.argv[1] if len(sys.argv) > 1 else ''
PAGES = ['/', '/jerseys', '/jerseys?league=NFL&colourway=white', '/request', '/track',
         '/cart', '/checkout', '/jerseys/team-brazil-romario-yellow-jersey',
         # The pages that were dead footer links until they existed.
         '/shipping', '/returns', '/size-guide',
         '/policies/privacy', '/policies/terms', '/policies/refunds',
         # Accounts. Four forms, which is where labelling goes wrong.
         '/account/login', '/account/register', '/account/forgot',
         '/account/reset?token=demo&email=fan%40example.com',
         # The custom-jersey line: its own listing view and a product page.
         '/jerseys?custom=true', '/jerseys/dallas-cowboys-custom-blue-jersey',
         # Pages built from the live store's own copy.
         '/contact', '/privacy-choices', '/policies/shipping',
         # Curated collections — a different navigation from the facets.
         '/collections/best-sellers', '/collections/world-cup-2026']


class Audit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.problems: list[str] = []
        self.headings: list[int] = []
        self.ids: dict[str, int] = {}
        self.labels_for: set[str] = set()
        self.inputs: list[tuple[str, dict]] = []
        self.open_button: dict | None = None
        self.button_text = ''
        self.open_a: dict | None = None
        self.a_text = ''
        self.has_main = False
        self.in_main = False
        # The page's own outline: headings inside <main> and *outside* any <nav>.
        #
        # Both exclusions are deliberate. The site header carries h3 column labels inside
        # the mega panels, and the listing page carries h3 group labels inside the facet
        # rail — both are legitimate structure inside a labelled navigation landmark, and
        # both would otherwise be read as the document opening at h3. What a screen-reader
        # user gets from a heading list is the document, and a filter group is not part of
        # the document.
        self.main_headings: list[int] = []
        self.nav_depth = 0
        self.has_h1 = 0
        self.navs: list[dict] = []
        self.radio_groups: dict[str, int] = {}
        self.open_fieldsets = 0
        self.fieldset_has_legend: list[bool] = []
        self.radios_outside_fieldset: set[str] = set()
        self.selects: list[dict] = []
        self.live_regions = 0
        self.first_link: dict | None = None
        self.skip_target: str | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if 'id' in a:
            self.ids[a['id']] = self.ids.get(a['id'], 0) + 1
        if tag == 'img':
            if 'alt' not in a:
                self.problems.append(f'<img> with no alt attribute: src={a.get("src","?")[:60]}')
        if tag in ('input', 'select', 'textarea'):
            self.inputs.append((tag, a))
        if tag == 'label' and 'for' in a:
            self.labels_for.add(a['for'])
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.headings.append(int(tag[1]))
            if self.in_main and self.nav_depth == 0:
                self.main_headings.append(int(tag[1]))
            if tag == 'h1':
                self.has_h1 += 1
        if tag == 'main':
            self.has_main = True
            self.in_main = True
        if tag == 'nav':
            self.navs.append(a)
            self.nav_depth += 1
        if tag == 'fieldset':
            self.open_fieldsets += 1
            self.fieldset_has_legend.append(False)
        if tag == 'legend' and self.fieldset_has_legend:
            self.fieldset_has_legend[-1] = True
        if tag == 'select':
            self.selects.append(a)
        if a.get('role') == 'status' or a.get('role') == 'alert' or a.get('aria-live'):
            self.live_regions += 1
        if tag == 'input' and a.get('type') == 'radio' and a.get('name'):
            name = a['name']
            self.radio_groups[name] = self.radio_groups.get(name, 0) + 1
            if self.open_fieldsets == 0:
                self.radios_outside_fieldset.add(name)
        if tag == 'button':
            self.open_button, self.button_text = a, ''
        if tag == 'a':
            self.open_a, self.a_text = a, ''
            if self.first_link is None:
                self.first_link = a
                href = a.get('href', '')
                if href.startswith('#'):
                    self.skip_target = href[1:]

    def handle_data(self, d):
        if self.open_button is not None:
            self.button_text += d
        if self.open_a is not None:
            self.a_text += d

    def handle_endtag(self, tag):
        if tag == 'main':
            # The footer's headings come after it and are not part of the page's outline.
            self.in_main = False
        if tag == 'nav':
            self.nav_depth = max(0, self.nav_depth - 1)
        if tag == 'button' and self.open_button is not None:
            a = self.open_button
            if not self.button_text.strip() and not a.get('aria-label') and not a.get('aria-labelledby'):
                self.problems.append('<button> with no accessible name')
            self.open_button = None
        if tag == 'a' and self.open_a is not None:
            a = self.open_a
            if not self.a_text.strip() and not a.get('aria-label') and not a.get('aria-labelledby'):
                self.problems.append(f'<a href="{a.get("href","?")[:40]}"> with no accessible name')
            self.open_a = None

    def handle_endtag_fieldset(self):
        pass

    def finish(self):
        for tag, a in self.inputs:
            if a.get('type') in ('hidden', 'submit', 'button'):
                continue
            named = (a.get('id') in self.labels_for) or a.get('aria-label') or a.get('aria-labelledby')
            if not named:
                self.problems.append(f'<{tag} name={a.get("name", a.get("id", "?"))}> has no label')
        prev = 0
        for h in self.headings:
            if prev and h > prev + 1:
                self.problems.append(f'heading jumps from h{prev} to h{h}')
            prev = h
        for k, n in self.ids.items():
            if n > 1:
                self.problems.append(f'duplicate id "{k}" ×{n}')
        if not self.has_main:
            self.problems.append('no <main> landmark')
        if self.has_h1 != 1:
            self.problems.append(f'{self.has_h1} <h1> elements (want exactly 1)')

        # The page's own outline has to *start* at h1.
        #
        # The jump check above cannot see this: it starts at prev=0, so the first heading
        # never trips it, and an h2 sitting before the h1 is not a jump *down* — it is the
        # h1 arriving late. A real one got through. The jurisdiction panel on the privacy
        # policy was rendered in its own band above the document, which read correctly and
        # opened the page h2-then-h1; a screen-reader user pulling up the heading list got
        # a section before the thing it is a section of.
        #
        # Scoped to <main> on purpose — see `main_headings`.
        if self.main_headings and self.main_headings[0] != 1:
            self.problems.append(
                f'first heading in <main> is h{self.main_headings[0]}, not h1'
            )

        # More than one <nav> and they must be distinguishable by name, or a screen reader
        # announces "navigation" twice and the listener cannot tell them apart.
        if len(self.navs) > 1:
            unnamed = [n for n in self.navs
                       if not n.get('aria-label') and not n.get('aria-labelledby')]
            if unnamed:
                self.problems.append(
                    f'{len(unnamed)} of {len(self.navs)} <nav> landmarks have no '
                    'accessible name')
            labels = [n.get('aria-label') for n in self.navs if n.get('aria-label')]
            if len(labels) != len(set(labels)):
                self.problems.append('two <nav> landmarks share the same aria-label')

        # A radio group with no fieldset/legend reads each option with no question attached.
        for name in sorted(self.radios_outside_fieldset):
            if self.radio_groups.get(name, 0) > 1:
                self.problems.append(
                    f'radio group "{name}" ({self.radio_groups[name]} options) is not in a '
                    '<fieldset>')
        for i, has_legend in enumerate(self.fieldset_has_legend):
            if not has_legend:
                self.problems.append(f'<fieldset> #{i + 1} has no <legend>')

        # A <select> that mutates state on change (rather than submitting a form the user
        # can see) needs its result announced; there is no page transition to notice.
        if self.selects and self.live_regions == 0:
            named = [s for s in self.selects if s.get('id') in ('region', 'region-compact')]
            if named:
                self.problems.append(
                    'a state-changing <select> is present with no live region to announce '
                    'the change')

        # The skip link has to be the first link and has to land somewhere real.
        if self.first_link is not None:
            if not self.skip_target:
                self.problems.append(
                    'the first link is not a skip link (want href="#main" first)')
            elif self.skip_target not in self.ids:
                self.problems.append(
                    f'skip link points at #{self.skip_target}, which is not an id on the page')

        return self.problems


total = 0
for path in PAGES:
    req = urllib.request.Request(BASE + path)
    if CART:
        req.add_header('Cookie', f'aj_cart={CART}')
    try:
        html = urllib.request.urlopen(req).read().decode('utf-8', 'replace')
    except Exception as e:
        print(f'  {path:<48} FETCH FAILED {e}')
        continue
    # ignore Next's dev-tools and RSC payload scripts
    html = re.sub(r'<script.*?</script>', '', html, flags=re.S)
    a = Audit()
    a.feed(html)
    problems = a.finish()
    total += len(problems)
    mark = 'OK  ' if not problems else 'WARN'
    print(f'  {mark} {path:<48} {len(problems)} issue(s)')
    for p in dict.fromkeys(problems):
        print(f'         - {p}')

print()
print(f'  {total} mechanical issue(s) across {len(PAGES)} pages.')
print('  Colour contrast is checked by spike/contrast_check.py, not by eye.')
print('  The checks here are self-tested by spike/a11y_selftest.py — a check that cannot')
print('  fail is worse than no check.')
print()
print('  Still outstanding, and not automatable here: listening to VoiceOver or NVDA work')
print('  the buy box and checkout, and a keyboard-only traversal by hand (research.md §7.9).')
# Exit non-zero on findings so CI fails rather than printing warnings nobody reads.
sys.exit(1 if total else 0)
