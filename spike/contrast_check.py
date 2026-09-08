#!/usr/bin/env python3
"""Contrast audit over the storefront's colour tokens.

    python3 spike/contrast_check.py [path/to/globals.css]

WCAG 2.1 AA needs 4.5:1 for body text, and 3:1 for large text (>=24px, or >=18.66px bold)
and for the boundary of a UI component. research.md 7.9 makes this a legal requirement
under the EAA and a litigation exposure under the ADA, not a preference — so it is checked
by a script rather than by eye.

This is the half of the accessibility problem a machine can actually settle. It reads the
tokens out of globals.css and checks the pairs the design puts together; it cannot know
about a pair nobody listed here, so a new colour combination means a new line in PAIRS.

The one thing it deliberately does not flag: `--rule` against paper, at 1.27:1. That token
is for dividers, and a purely decorative line is explicitly exempt from 1.4.11. Form control
borders use `--field` instead, which is checked, and that separation is the whole reason
there are two tokens.
"""
import re, sys, itertools

def lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lum(hexstr):
    h = hexstr.lstrip('#')
    if len(h) == 3:
        h = ''.join(ch * 2 for ch in h)
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

TOKENS = {}
DEFAULT_CSS = 'spike/storefront/app/globals.css'
css = open(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSS).read()
for m in re.finditer(r'--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,6})', css):
    TOKENS[m.group(1)] = m.group(2)

# Pairs the design actually puts together, read from globals.css and the components.
PAIRS = [
    ('body text on paper',        'ink',   'paper', 4.5),
    ('secondary text on paper',   'ink-2', 'paper', 4.5),
    ('muted text on paper',       'ink-3', 'paper', 4.5),
    ('muted text on wash',        'ink-3', 'wash',  4.5),
    ('secondary text on wash',    'ink-2', 'wash',  4.5),
    ('body text on wash',         'ink',   'wash',  4.5),
    ('focus ring on paper',       'teal',  'paper', 3.0),
    ('focus ring on wash',        'teal',  'wash',  3.0),
    ('teal text on paper',        'teal',  'paper', 4.5),
    # Form control boundaries — 1.4.11 applies to these. `--rule` is deliberately absent:
    # it is for dividers, which are exempt as decorative, and it would fail at 1.27:1.
    ('field border on paper',     'field', 'paper', 3.0),
    ('field border on wash',      'field', 'wash',  3.0),
]

LITERAL = [
    # Non-token colours used inline in components and templates.
    ('yellow button label',   '#121212', TOKENS.get('yellow', '#F9E806'), 4.5),
    ('hero body on ink',      '#D6D6D2', TOKENS.get('ink', '#121212'),    4.5),
    ('announce text on ink',  '#FFFFFF', TOKENS.get('ink', '#121212'),    4.5),
    ('yellow on ink',         TOKENS.get('yellow', '#F9E806'), TOKENS.get('ink', '#121212'), 3.0),
    ('error text on paper',   '#B3261E', TOKENS.get('paper', '#FFFFFF'),  4.5),
    ('email footer grey',     '#6a6a6a', '#ffffff', 4.5),
    ('email body grey',       '#4a4a4a', '#ffffff', 4.5),
]

fails = []
print(f"{'pair':32} {'fg':9} {'bg':9} {'ratio':>7}  need   verdict")
print('-' * 78)
for label, fg_key, bg_key, need in PAIRS:
    fg, bg = TOKENS.get(fg_key), TOKENS.get(bg_key)
    if not fg or not bg:
        print(f'{label:32} MISSING TOKEN {fg_key}/{bg_key}')
        continue
    r = ratio(fg, bg)
    ok = r >= need
    if not ok:
        fails.append((label, fg, bg, r, need))
    print(f'{label:32} {fg:9} {bg:9} {r:7.2f}  {need:.1f}   {"PASS" if ok else "FAIL"}')

for label, fg, bg, need in LITERAL:
    r = ratio(fg, bg)
    ok = r >= need
    if not ok:
        fails.append((label, fg, bg, r, need))
    print(f'{label:32} {fg:9} {bg:9} {r:7.2f}  {need:.1f}   {"PASS" if ok else "FAIL"}')

print()
if fails:
    print(f'{len(fails)} failure(s):')
    for label, fg, bg, r, need in fails:
        print(f'  {label}: {fg} on {bg} is {r:.2f}:1, needs {need}:1')
    sys.exit(1)
print('all pairs pass')
