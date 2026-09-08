import re, html, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = str(ROOT / 'research.md')
lines = open(SRC).read().split('\n')

# --- inline formatting -------------------------------------------------------
SEV = {
 'very high':'sev-hi','high':'sev-hi','medium':'sev-md','low':'sev-lo',
 'severe':'sev-hi','high if not planned':'sev-hi',
}

def inline(t):
    t = html.escape(t, quote=False)
    codes = []
    def stash(m):
        codes.append(m.group(1)); return f'\x00{len(codes)-1}\x00'
    t = re.sub(r'`([^`]+)`', stash, t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<em>\1</em>', t)
    t = re.sub(r'\x00(\d+)\x00', lambda m: '<code>'+codes[int(m.group(1))]+'</code>', t)
    t = t.replace('✅', '<span class="pick" aria-label="recommended">pick</span>')
    return t

NUMY = re.compile(r'^[~<>€$£\d\s.,%+\-–—/kr]*$', re.I)
def cell(txt, is_head):
    raw = txt.strip()
    cls = []
    key = re.sub(r'[*]', '', raw).strip().lower()
    body = inline(raw)
    if not is_head and key in SEV:
        body = f'<span class="sev {SEV[key]}">{html.escape(raw)}</span>'
    elif not is_head and raw and NUMY.match(raw) and re.search(r'\d', raw):
        cls.append('num')
    c = f' class="{" ".join(cls)}"' if cls else ''
    tag = 'th' if is_head else 'td'
    return f'<{tag}{c}>{body}</{tag}>'


def render_item(ls):
    """Render one list item's dedented lines: paragraphs, fenced code, nested lists."""
    parts, k = [], 0
    while k < len(ls):
        l = ls[k]
        if l.strip().startswith('```'):
            k += 1; buf = []
            while k < len(ls) and not ls[k].strip().startswith('```'):
                buf.append(ls[k]); k += 1
            k += 1
            while buf and not buf[0].strip(): buf.pop(0)
            while buf and not buf[-1].strip(): buf.pop()
            pad = min((len(b) - len(b.lstrip()) for b in buf if b.strip()), default=0)
            code = '\n'.join(b[pad:] for b in buf)
            parts.append(f'<div class="codewrap"><pre><code>{html.escape(code, quote=False)}</code></pre></div>')
            continue
        if re.match(r'^[-*]\s+', l):
            sub = []
            while k < len(ls):
                if re.match(r'^[-*]\s+', ls[k]):
                    sub.append(re.sub(r'^[-*]\s+', '', ls[k]).strip()); k += 1
                elif sub and ls[k].startswith('  ') and ls[k].strip():
                    sub[-1] += ' ' + ls[k].strip(); k += 1
                else:
                    break
            parts.append('<ul>' + ''.join(f'<li>{inline(x)}</li>' for x in sub) + '</ul>')
            continue
        buf = []
        while k < len(ls) and ls[k].strip() and not ls[k].strip().startswith('```') and not re.match(r'^[-*]\s+', ls[k]):
            buf.append(ls[k].strip()); k += 1
        if buf:
            parts.append(f'<p>{inline(" ".join(buf))}</p>')
        else:
            k += 1
    if len(parts) == 1 and parts[0].startswith('<p>'):
        return parts[0][3:-4]
    return ''.join(parts)

# --- block parse ------------------------------------------------------------
out, toc = [], []
i = 0
sec_open = False
# skip masthead: everything up to first '## '
while i < len(lines) and not lines[i].startswith('## '):
    i += 1

def close_sec():
    global sec_open
    if sec_open:
        out.append('</section>')
        sec_open = False

while i < len(lines):
    ln = lines[i]

    if ln.startswith('## '):
        close_sec()
        title = ln[3:].strip().replace('⚠️','').strip()
        m = re.match(r'^(\d+)\.\s+(.*)$', title)
        num, label = (m.group(1).zfill(2), m.group(2)) if m else (None, title)
        sid = 's' + re.sub(r'[^a-z0-9]+','-', label.lower()).strip('-')
        toc.append((num, label, sid))
        out.append(f'<section id="{sid}">')
        sec_open = True
        eyebrow = f'<span class="secnum">{num}</span>' if num else ''
        out.append(f'<h2>{eyebrow}<span>{inline(label)}</span></h2>')
        i += 1; continue

    if ln.startswith('### '):
        t = ln[4:].strip().replace('⚠️','').strip()
        out.append(f'<h3>{inline(t)}</h3>')
        i += 1; continue

    if ln.strip() == '---':
        i += 1; continue

    if ln.startswith('> ') or ln == '>':
        buf = []
        while i < len(lines) and (lines[i].startswith('> ') or lines[i] == '>'):
            buf.append(lines[i][2:] if lines[i].startswith('> ') else '')
            i += 1
        paras, cur = [], []
        for b in buf:
            if b.strip():
                cur.append(b.strip())
            elif cur:
                paras.append(' '.join(cur)); cur = []
        if cur:
            paras.append(' '.join(cur))
        out.append('<blockquote>' + ''.join(f'<p>{inline(x)}</p>' for x in paras) + '</blockquote>')
        continue

    if ln.startswith('```'):
        lang = ln[3:].strip()
        i += 1
        buf = []
        while i < len(lines) and not lines[i].startswith('```'):
            buf.append(lines[i]); i += 1
        i += 1
        code = html.escape('\n'.join(buf), quote=False)
        cl = ' class="lang-'+lang+'"' if lang else ''
        out.append(f'<div class="codewrap"><pre{cl}><code>{code}</code></pre></div>')
        continue

    if ln.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            rows.append(lines[i]); i += 1
        def split(r):
            r = r.strip()
            if r.startswith('|'): r = r[1:]
            if r.endswith('|'): r = r[:-1]
            return r.split('|')
        head = split(rows[0])
        body = rows[2:] if len(rows) > 1 and set(rows[1].replace('|','').strip()) <= set('-: ') else rows[1:]
        t = ['<div class="table-wrap"><table>']
        if any(h.strip() for h in head):
            t.append('<thead><tr>' + ''.join(cell(h, True) for h in head) + '</tr></thead>')
        t.append('<tbody>')
        for r in body:
            cells = split(r)
            filled = [c for c in cells if c.strip()]
            spanner = len(filled) == 1 and len(cells) > 2
            if spanner:
                t.append(f'<tr class="grouprow"><td colspan="{len(cells)}">{inline(filled[0].strip())}</td></tr>')
            else:
                t.append('<tr>' + ''.join(cell(c, False) for c in cells) + '</tr>')
        t.append('</tbody></table></div>')
        out.append('\n'.join(t))
        continue

    if re.match(r'^- \[[ x]\] ', ln):
        items = []
        while i < len(lines) and re.match(r'^- \[[ x]\] ', lines[i]):
            items.append(inline(lines[i][6:].strip())); i += 1
        out.append('<ul class="checklist">' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>')
        continue

    m_ul = re.match(r'^[-*] ', ln)
    m_ol = re.match(r'^(\d+)\. ', ln)
    if m_ul or m_ol:
        ordered = bool(m_ol)
        marker = re.compile(r'^\d+\.\s+') if ordered else re.compile(r'^[-*]\s+')
        indent = 3 if ordered else 2
        items, cur = [], None
        while i < len(lines):
            l = lines[i]
            if marker.match(l):
                if cur is not None: items.append(cur)
                cur = [marker.sub('', l).rstrip()]
                i += 1; continue
            if l.strip() == '':
                j = i + 1
                while j < len(lines) and lines[j].strip() == '': j += 1
                if j < len(lines) and (marker.match(lines[j]) or lines[j].startswith(' ' * indent)):
                    if cur is not None: cur.append('')
                    i = j; continue
                break
            if cur is not None and l.startswith(' ' * indent):
                cur.append(l[indent:].rstrip()); i += 1; continue
            break
        if cur is not None: items.append(cur)
        tag = 'ol' if ordered else 'ul'
        out.append(f'<{tag}>' + ''.join(f'<li>{render_item(x)}</li>' for x in items) + f'</{tag}>')
        continue

    if ln.strip() == '':
        i += 1; continue

    # paragraph
    buf = []
    while i < len(lines) and lines[i].strip() and not re.match(r'^(#{2,3} |\||```|[-*] |\d+\. |---)', lines[i]):
        buf.append(lines[i].strip()); i += 1
    para = ' '.join(buf)
    cls = ''
    if para.startswith('**') and para.count('**') == 2 and para.endswith('**'):
        cls = ' class="lede"'
    out.append(f'<p{cls}>{inline(para)}</p>')

close_sec()
body = '\n'.join(out)

toc_html = []
for num, label, sid in toc:
    n = f'<span class="tnum">{num}</span>' if num else '<span class="tnum tdash">—</span>'
    toc_html.append(f'<li><a href="#{sid}">{n}<span>{html.escape(label)}</span></a></li>')
toc_html = '\n'.join(toc_html)

open(Path(__file__).parent / 'body.html','w').write(body)
open(Path(__file__).parent / 'toc.html','w').write(toc_html)
print('sections:', len(toc))
print('body chars:', len(body))
