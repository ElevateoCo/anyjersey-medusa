#!/usr/bin/env python3
"""Self-test for the checks in a11y_check.py.

    python3 spike/a11y_selftest.py

Every check gets a page that should trip it and a page that should not. The reason this
file exists is the same reason the media route's regression test sends no headers at all: a
check that cannot fail passes whether the thing it guards is working or not, and an
accessibility audit reporting "0 issues" is exactly where that failure hides. When
`a11y_check.py` reported 0 issues across 18 pages, this is what established that the number
meant something.
"""
import importlib.util, sys

SRC = __file__.replace('a11y_selftest.py', 'a11y_check.py')
src = open(SRC).read()
# a11y_check runs its audit loop at import and needs a live server; take only the class.
ns: dict = {}
exec(compile(src[: src.index('total = 0')], 'a11y_check', 'exec'), ns)
Audit = ns['Audit']


def audit(html: str) -> list[str]:
    a = Audit()
    a.feed(html)
    return a.finish()


# A minimal page that passes everything, so each case below isolates one defect.
OK = '<a href="#main">Skip</a><main id="main"><h1>T</h1>%s</main>'

SHOULD_FIRE = {
    'img with no alt': OK % '<img src="/a.webp">',
    'button with no name': OK % '<button></button>',
    'input with no label': OK % '<input name="q">',
    'heading jump h1 to h3': OK % '<h3>Sub</h3>',
    'duplicate id': OK % '<p id="d">a</p><p id="d">b</p>',
    'no main landmark': '<a href="#main">Skip</a><h1>T</h1>',
    'two h1': OK % '<h1>Second</h1>',
    'two unnamed navs':
        OK % '<nav><a href="/a">A</a></nav><nav><a href="/b">B</a></nav>',
    'two navs sharing a label':
        OK % ('<nav aria-label="Main"><a href="/a">A</a></nav>'
              '<nav aria-label="Main"><a href="/b">B</a></nav>'),
    'radios with no fieldset':
        OK % ('<input type="radio" name="k" id="k1"><label for="k1">A</label>'
              '<input type="radio" name="k" id="k2"><label for="k2">B</label>'),
    'fieldset with no legend':
        OK % ('<fieldset><input type="radio" name="k" id="k1"><label for="k1">A</label>'
              '<input type="radio" name="k" id="k2"><label for="k2">B</label></fieldset>'),
    'state-changing select with no live region':
        OK % '<label for="region">Ship to</label><select id="region"><option>US</option></select>',
    'skip link not first':
        '<a href="/shop">Shop</a><a href="#main">Skip</a><main id="main"><h1>T</h1></main>',
    'skip link to a missing id': '<a href="#nope">Skip</a><main id="main"><h1>T</h1></main>',
    # The defect this rule was added for: a section rendered above the document's own
    # title, so the page opens h2-then-h1 and a heading list offers a section before the
    # thing it is a section of. The jump check cannot see it — it starts at prev=0, so the
    # first heading never trips it, and a late h1 is not a jump downwards.
    'section heading before the h1':
        '<a href="#main">Skip</a><main id="main"><h2>Your rights</h2><h1>T</h1></main>',
}

SHOULD_NOT_FIRE = {
    'img with alt': OK % '<img src="/a.webp" alt="A grey jersey">',
    'img with empty alt (decorative)': OK % '<img src="/a.webp" alt="">',
    'button named by aria-label': OK % '<button aria-label="Close"></button>',
    'input labelled by for/id': OK % '<label for="q">Search</label><input id="q" name="q">',
    'hidden input needs no label': OK % '<input type="hidden" name="token">',
    'ordered headings': OK % '<h2>Sub</h2><h3>Deeper</h3>',
    'two named navs':
        OK % ('<nav aria-label="Main"><a href="/a">A</a></nav>'
              '<nav aria-label="Filters"><a href="/b">B</a></nav>'),
    'one unnamed nav is fine': OK % '<nav><a href="/a">A</a></nav>',
    'fieldset with legend':
        OK % ('<fieldset><legend>Pick one</legend>'
              '<input type="radio" name="k" id="k1"><label for="k1">A</label>'
              '<input type="radio" name="k" id="k2"><label for="k2">B</label></fieldset>'),
    'select with a live region':
        OK % ('<label for="region">Ship to</label><select id="region"><option>US</option>'
              '</select><span role="status"></span>'),
    # Both exclusions the outline rule makes, pinned so neither is quietly widened.
    'nav headings before the h1 are landmark structure, not the outline':
        ('<a href="#main">Skip</a><main id="main">'
         '<nav aria-label="Filter jerseys"><h3>League</h3><a href="/a">NFL</a></nav>'
         '<h1>T</h1></main>'),
    'footer headings after </main> are not the outline':
        OK % '' + '<footer><h2>Shop</h2></footer>',
}


def main() -> int:
    wrong = 0
    print('checks that must fire on the defect:')
    for name, html in SHOULD_FIRE.items():
        problems = audit(html)
        if problems:
            print(f'  ok      {name}')
        else:
            print(f'  MISSED  {name}')
            wrong += 1

    print('\nchecks that must stay quiet on correct markup:')
    for name, html in SHOULD_NOT_FIRE.items():
        problems = audit(html)
        if not problems:
            print(f'  ok      {name}')
        else:
            print(f'  FALSE+  {name}: {problems}')
            wrong += 1

    total = len(SHOULD_FIRE) + len(SHOULD_NOT_FIRE)
    print()
    if wrong:
        print(f'  {wrong} of {total} wrong')
        return 1
    print(f'  {total} of {total} correct')
    return 0


if __name__ == '__main__':
    sys.exit(main())
