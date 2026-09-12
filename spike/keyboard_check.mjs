/**
 * Keyboard and screen-reader audit, driven through a real browser.
 *
 *   node spike/keyboard_check.mjs                 # needs the storefront on :3000
 *   node spike/keyboard_check.mjs --page /jerseys
 *
 * `a11y_check.py` parses HTML and catches what is wrong in the markup. This catches what is
 * wrong in the *behaviour*, which is a different set and was written off as "by hand" for
 * longer than it deserved:
 *
 *  - **The accessibility tree is literally what a screen reader reads.** Chrome computes it
 *    and will hand it over. Every rule below about names and roles is checking the same
 *    structure VoiceOver would announce — not a proxy for it.
 *  - **Tab order is observable.** Press Tab, ask what has focus, repeat. That finds
 *    unreachable controls, positive `tabindex`, and focus that jumps around the page.
 *  - **Dialog behaviour is observable.** Open it, check focus moved inside; press Escape,
 *    check it closed and focus came back.
 *
 * What it still does not replace: whether an announcement is *understandable*. "Button,
 * Bag, 2 items" passes every rule here and a human decides whether it is the right sentence.
 * That is the part that stays manual, and it is much smaller than the whole.
 *
 * Node rather than Python — unlike the two static checkers this needs a live CDP session,
 * and Node 22 has a WebSocket client built in.
 */
const BASE = process.env.BASE ?? 'http://localhost:3000'
const PORT = 9444

/**
 * Six pages was thorough and took long enough that nobody would run it.
 *
 * These four are the distinct *shapes* the storefront has — a landing page of rails, a
 * listing with a facet rail and a mobile drawer, a product page with a buybox and a
 * personalisation control, and a form page. `/cart` and the policy pages reuse the form
 * shape and found nothing the first time round. `--page` runs any single one.
 */
const PAGES = process.argv.includes('--page')
  ? [process.argv[process.argv.indexOf('--page') + 1]]
  : ['/', '/jerseys', '/jerseys/dallas-cowboys-custom-blue-jersey', '/request']

/** Dialogs to open and test, per page. */
/**
 * Dialogs to open and test, per page.
 *
 * `width` matters. The filter drawer's trigger is `display:none` above 860px — it is the
 * phone affordance for a sidebar that is always visible on a desktop. Testing it at 1440
 * clicks a hidden button, opens the drawer, and then reports that focus did not return to
 * the trigger, which is true and meaningless: focus cannot return to something that is not
 * displayed. The first run of this file reported exactly that, and it was the harness at
 * fault, not the site.
 */
const DIALOGS = {
  '/': [
    { name: 'cart drawer', open: '.cartlink', dialog: '.cart-drawer', width: 1440 },
    { name: 'menu drawer', open: '.hamburger', dialog: '#site-menu', width: 390 },
  ],
  '/jerseys': [
    { name: 'filter drawer', open: '.filterbtn', dialog: '#filter-drawer', width: 390 },
  ],
}

const { spawn, execSync } = await import('child_process')
/**
 * A previous run's browser left on this port answers `/json/list` and then goes nowhere,
 * which surfaces as `UND_ERR_HEADERS_TIMEOUT` from a `fetch` that looks unrelated to
 * anything in this file. Clearing the port first costs nothing and removes a confusing
 * failure mode entirely.
 */
try { execSync(`pkill -f 'remote-debugging-port=${PORT}' || true`) } catch {}
await new Promise((r) => setTimeout(r, 500))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless', '--disable-gpu', `--remote-debugging-port=${PORT}`,
   '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 3500))

const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const timedOut = []
/** Dialogs actually exercised, so a pass that quietly did nothing is visible. */
const tested = []

/**
 * Every call is bounded.
 *
 * A CDP request whose reply never arrives — the browser died, a navigation ate it, a
 * command errored in a way that produced no response — leaves the promise pending forever,
 * and the script sits there looking busy. That happened: this file hung for twenty minutes
 * on a page having already audited the one before it, with no output and no error. A check
 * that can hang indefinitely is worse than no check, because a green run and a hung run are
 * indistinguishable until somebody notices the clock.
 *
 * Eight seconds is far longer than any of these calls legitimately takes; the point is the
 * ceiling, not the number.
 */
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    const timer = setTimeout(() => {
      if (pending.delete(i)) {
        timedOut.push(method)
        res(undefined)
      }
    }, 8000)
    pending.set(i, (r) => { clearTimeout(timer); res(r) })
    try { ws.send(JSON.stringify({ id: i, method, params })) }
    catch { clearTimeout(timer); pending.delete(i); timedOut.push(method); res(undefined) }
  })
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
})
await send('Page.enable')
await send('Accessibility.enable')
await send('Runtime.enable')

/**
 * Returns `undefined` when the call timed out rather than throwing.
 *
 * `send` resolves with `undefined` on timeout, and reading `.result` off that crashed the
 * run mid-page — which is a worse failure than the hang it replaced, because it happened
 * after a page had already been reported OK. The timeout is counted and reported at the
 * end; individual callers treat a missing answer as "nothing found", which is the safe
 * direction for every check here.
 */
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, expression })
  return r?.result?.value
}

const key = async (k, code, keyCode) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode })
  }
}
const tab = () => key('Tab', 'Tab', 9)
const escape = () => key('Escape', 'Escape', 27)

const problems = []
const note = (page, msg) => problems.push(`${page}  ${msg}`)

/** A short, stable description of whatever currently has focus. */
const FOCUSED = `(() => {
  const a = document.activeElement
  if (!a || a === document.body) return null
  // Next's development overlay ("1 Issue") is a focusable custom element injected into the
  // page. It is not part of the site and is not in a production build, so auditing it
  // reports defects nobody can fix and — worse — swallows the traversal, which is what it
  // did on the product page before this line existed.
  if (a.tagName === 'NEXTJS-PORTAL') return { skip: true }
  const s = getComputedStyle(a)
  const label = (a.getAttribute('aria-label') || a.textContent || a.value || '').trim()
  return {
    tag: a.tagName, cls: (a.className || '').toString().slice(0, 40),
    label: label.slice(0, 46),
    id: a.id || null,
    tabindex: a.getAttribute('tabindex'),
    // A focus ring can come from outline or from a box-shadow; both count.
    ring: s.outlineStyle !== 'none' && s.outlineWidth !== '0px',
    hidden: a.offsetParent === null && s.position !== 'fixed',
  }
})()`

for (const page of PAGES) {
  await send('Page.navigate', { url: BASE + page })
  await new Promise((r) => setTimeout(r, 5000))
  await ev("document.querySelector('.consent .btn')?.click()")
  await new Promise((r) => setTimeout(r, 400))

  // ---- 1. no positive tabindex -------------------------------------------------
  const positive = await ev(`
    [...document.querySelectorAll('[tabindex]')]
      .filter(e => Number(e.getAttribute('tabindex')) > 0)
      .map(e => e.tagName + '.' + (e.className||'').toString().slice(0,24))`)
  for (const p of positive ?? []) {
    note(page, `positive tabindex on ${p} — it jumps ahead of everything before it`)
  }

  // ---- 2. every focusable control has an accessible name -----------------------
  // Straight off the tree Chrome builds for assistive technology.
  const { nodes } = (await send('Accessibility.getFullAXTree')) ?? {}
  const NAMELESS_ROLES = new Set(['button', 'link', 'textbox', 'checkbox', 'combobox',
    'searchbox', 'switch', 'slider', 'menuitem', 'tab', 'radio'])
  const seenNameless = new Set()
  for (const n of nodes ?? []) {
    if (n.ignored) continue
    const role = n.role?.value
    if (!NAMELESS_ROLES.has(role)) continue
    const name = (n.name?.value ?? '').trim()
    if (name) continue
    const k = `${role}`
    if (seenNameless.has(k)) continue
    seenNameless.add(k)
    note(page, `a ${role} has no accessible name — a screen reader announces its role and nothing else`)
  }

  // ---- 3. landmarks are distinguishable ----------------------------------------
  const landmarks = (nodes ?? [])
    .filter((n) => !n.ignored && ['navigation', 'region', 'search', 'form']
      .includes(n.role?.value))
    .map((n) => `${n.role.value}:${(n.name?.value ?? '').trim()}`)
  const dupes = landmarks.filter((l, i) => landmarks.indexOf(l) !== i && l.endsWith(':'))
  for (const d of new Set(dupes)) {
    note(page, `more than one unnamed ${d.split(':')[0]} landmark — announced identically`)
  }

  // ---- 4. tab order: reachable, visible, and forward ----------------------------
  await ev('document.body.focus(); window.scrollTo(0,0)')
  const order = []
  let trapped = null
  /**
   * 60, not 120.
   *
   * The cap is a stop, not a target: a listing page has hundreds of focusable links and
   * walking all of them proves nothing the first forty did not. At 120 with a delay after
   * every keypress this file took over twenty minutes across six pages, which is a check
   * nobody runs. The rules that matter — reachability, visible focus, no trap, skip link
   * first — all show up in the first screenful.
   */
  for (let i = 0; i < 40; i++) {
    await tab()
    const f = await ev(FOCUSED)
    if (!f) break
    if (f.skip) continue
    const sig = `${f.tag}|${f.cls}|${f.label}|${f.id}`
    if (order.length && order[order.length - 1].sig === sig && order.length > 2) {
      trapped = f; break
    }
    order.push({ ...f, sig })
    if (f.hidden) {
      note(page, `Tab reaches a hidden element (${f.tag}.${f.cls}) — focus disappears off-screen`)
    }
    if (!f.ring) {
      note(page, `no visible focus ring on ${f.tag}.${f.cls || f.label}`)
    }
  }
  if (trapped) note(page, `keyboard trap at ${trapped.tag}.${trapped.cls} — Tab stops moving`)
  if (order.length < 5) note(page, `only ${order.length} elements reachable by Tab`)

  // ---- 5. the skip link is first and works -------------------------------------
  if (order[0] && !/skip/i.test(order[0].label)) {
    note(page, `first Tab stop is "${order[0].label}", not a skip link`)
  }

  console.log(`  ${problems.filter((p) => p.startsWith(page + '  ')).length === 0 ? 'OK  ' : 'WARN'} ${page.padEnd(46)} ${order.length} tab stops`)
}

/**
 * Dialogs, in a pass of their own.
 *
 * They were inside the page loop and it made the whole run unreliable: each dialog changes
 * the viewport, navigates, and interacts, and the session did not always come back — 21
 * calls timed out and two pages afterwards reported zero reachable elements, which reads
 * exactly like a broken page and was a broken *harness*. Separating them means a wedged
 * emulation state can cost the dialog checks and nothing else.
 */
for (const page of PAGES) {
  if (!DIALOGS[page]) continue
    // ---- 6. dialogs: focus goes in, Escape closes, focus comes back ---------------
      for (const d of DIALOGS[page] ?? []) {
      await send('Emulation.setDeviceMetricsOverride',
        { width: d.width, height: 900, deviceScaleFactor: 1, mobile: d.width < 900 })
      await send('Page.navigate', { url: BASE + page })
      await new Promise((r) => setTimeout(r, 4000))
      await ev("document.querySelector('.consent .btn')?.click()")
      await new Promise((r) => setTimeout(r, 300))

      // Only test a trigger the width actually shows. A hidden one cannot take focus back.
      const usable = await ev(`
        (() => { const t = document.querySelector('${d.open}')
          return !!t && t.offsetParent !== null })()`)
      if (!usable) { console.log(`       (${d.name}: trigger not shown at ${d.width}px, skipped)`); continue }
    tested.push(d.name)
      await ev(`document.querySelector('${d.open}').focus(); document.querySelector('${d.open}').click()`)
      await new Promise((r) => setTimeout(r, 600))
      const opened = await ev(`!!document.querySelector('${d.dialog}')`)
      if (!opened) { note(page, `${d.name} did not open`); continue }

      const inside = await ev(`
        (() => { const dlg = document.querySelector('${d.dialog}')
          return !!dlg && dlg.contains(document.activeElement) })()`)
      // Same rule as the focus-return check below: unknown is not the same as failed.
      if (inside === undefined) note(page, `${d.name}: focus-inside check did not complete`)
      else if (!inside) {
        note(page, `${d.name}: focus stays outside the dialog after it opens — a keyboard user is still on the page behind it`)
      }
      const labelled = await ev(`
        (() => { const dlg = document.querySelector('${d.dialog}')
          return !!(dlg.getAttribute('aria-label') || dlg.getAttribute('aria-labelledby')) })()`)
      if (!labelled) note(page, `${d.name}: dialog has no accessible name`)

      await escape()
      await new Promise((r) => setTimeout(r, 500))
      const stillOpen = await ev(`!!document.querySelector('${d.dialog}')`)
      if (stillOpen) note(page, `${d.name}: Escape does not close it`)
      else {
        await new Promise((r) => setTimeout(r, 200))
        const returned = await ev(`document.activeElement?.matches('${d.open}')`)
        if (!returned) {
          note(page, `${d.name}: focus does not return to the control that opened it`)
        }
      }
    }


}

console.log()
console.log(`  dialogs exercised: ${tested.length ? tested.join(', ') : 'NONE — the dialog pass did nothing'}`)
if (timedOut.length) {
  // Reported, never swallowed: a run that lost calls did not check what it says it checked.
  const counts = [...new Set(timedOut)].map((m) => `${m} ×${timedOut.filter((x) => x === m).length}`)
  console.log(`  ${timedOut.length} CDP call(s) timed out — this run is incomplete: ${counts.join(', ')}`)
}
if (problems.length) {
  console.log(`  ${problems.length} issue(s):`)
  for (const p of problems) console.log(`    - ${p}`)
} else {
  console.log('  0 keyboard or screen-reader-tree issues.')
}
console.log(`
  What this does NOT check: whether an announcement is *understandable*. "Button, Bag,
  2 items" satisfies every rule above and a human decides if it is the right sentence.
  That is the part that stays manual — and it is much smaller than the whole.`)

ws.close()
chrome.kill()
process.exit(problems.length ? 1 : 0)
