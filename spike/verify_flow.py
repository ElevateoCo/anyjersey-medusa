#!/usr/bin/env python3
"""Phase 0 verification — research.md §10 definition of done.

Drives the whole purchase path through the Store API with no storefront involved.
That is deliberate: it proves the payment path rather than a UI, and it makes the
"customer closes the browser immediately after paying" case trivial — there is no
browser to close.

    python3 verify_flow.py                      # run the flow
    python3 verify_flow.py --complete <cart_id> # complete a cart after paying

Needs the backend on :9000. Step 8 needs STRIPE_API_KEY in backend/.env; without it
the script stops there and says so.
"""
from __future__ import annotations
import argparse, json, sys, urllib.error, urllib.request
from pathlib import Path

API = 'http://localhost:9000'
HANDLE = 'buffalo-bills-josh-allen-blue-jersey'

G, R, Y, B, X = '\033[32m', '\033[31m', '\033[33m', '\033[1m', '\033[0m'
def step(n, s): print(f'\n{B}{n}. {s}{X}')
def ok(s):  print(f'  {G}OK{X}  {s}')
def bad(s): print(f'  {R}FAIL{X} {s}')
def note(s): print(f'      {s}')


STATE_FILE = Path(__file__).parent / 'spike-state.json'
if not STATE_FILE.exists():
    sys.exit('missing spike-state.json — run:\n'
             '  cd backend && npx medusa exec ./src/scripts/state.ts')
STATE = json.loads(STATE_FILE.read_text())
PK = STATE['publishable_key']


def call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'x-publishable-api-key': PK, 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors='replace')
        try:
            return {'__error': json.loads(raw), '__status': e.code}
        except json.JSONDecodeError:
            return {'__error': raw[:300], '__status': e.code}


def money(x) -> str:
    return f'${(x or 0):.2f}'


def complete(cart_id: str):
    res = call('POST', f'/store/carts/{cart_id}/complete')
    if res.get('type') == 'order' or 'order' in res:
        o = res.get('order') or res
        ok(f"order {o.get('id')} — display #{o.get('display_id')} — total {money(o.get('total'))}")
        note('Check the backend log for the ORDER CREATED VIA WEBHOOK banner.')
    else:
        bad(json.dumps(res)[:400])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--complete', metavar='CART_ID')
    args = ap.parse_args()
    if args.complete:
        return complete(args.complete)

    step(1, 'region')
    regions = call('GET', '/store/regions').get('regions') or []
    if not regions:
        return bad('no regions — run the seed script')
    region = regions[0]
    ok(f"{region['name']} / {region['currency_code']} — {region['id']}")

    step(2, 'product and variant')
    prods = call('GET', f"/store/products?handle={HANDLE}&region_id={region['id']}"
                        f"&fields=*variants.calculated_price").get('products') or []
    if not prods:
        return bad('product not found — run the seed script')
    p = prods[0]
    v = next((x for x in p['variants'] if x['title'] == 'L'), p['variants'][0])
    unit = (v.get('calculated_price') or {}).get('calculated_amount')
    ok(f"{p['title']}")
    note(f"variant {v['title']} · {v['sku']} · {money(unit)} · manage_inventory={v['manage_inventory']}")
    note(f"images: {len(p.get('images') or [])} (one, by decision — §13.6)")

    step(3, 'cart')
    # sales_channel_id is required whenever the publishable key is linked to more than
    # one channel, which it is here (Default + Web).
    res = call('POST', '/store/carts', {
        'region_id': region['id'],
        'email': 'spike@example.com',
        'sales_channel_id': STATE['sales_channel_id'],
    })
    cart = res.get('cart')
    if not cart:
        return bad(json.dumps(res.get('__error') or res)[:300])
    cid = cart['id']
    ok(cid)

    step(4, 'add line item')
    # Only variant_id and quantity cross the wire. The price is the server's. §5.2 rule 1.
    call('POST', f'/store/carts/{cid}/line-items', {'variant_id': v['id'], 'quantity': 1})
    cart = call('GET', f'/store/carts/{cid}').get('cart')
    ok(f"subtotal {money(cart.get('subtotal'))} — client sent only variant_id + quantity")

    step(5, 'addresses')
    addr = {'first_name': 'Spike', 'last_name': 'Test', 'address_1': '1 Example St',
            'city': 'Dallas', 'country_code': 'us', 'province': 'TX', 'postal_code': '75201'}
    call('POST', f'/store/carts/{cid}', {'shipping_address': addr, 'billing_address': addr})
    ok('shipping and billing set')

    step(6, 'shipping method')
    opts = call('GET', f'/store/shipping-options?cart_id={cid}').get('shipping_options') or []
    if not opts:
        return bad('no shipping options for this cart')
    so = opts[0]
    call('POST', f'/store/carts/{cid}/shipping-methods', {'option_id': so['id']})
    ok(f"{so['name']} {money(so.get('amount'))}")

    step(7, 'totals')
    cart = call('GET', f'/store/carts/{cid}').get('cart')
    for k in ('subtotal', 'shipping_total', 'tax_total', 'total'):
        print(f"      {k:<16} {money(cart.get(k))}")
    if abs((cart.get('total') or 0) - 69.98) < 0.01:
        ok('$69.98 processed — matches the unit economics in §9.1')
    else:
        note('(differs from the §9.1 model — check shipping and tax config)')

    step(8, 'Stripe payment session')
    pc = call('POST', '/store/payment-collections', {'cart_id': cid}).get('payment_collection')
    if not pc:
        return bad('payment collection not created')
    res = call('POST', f"/store/payment-collections/{pc['id']}/payment-sessions",
               {'provider_id': 'pp_stripe_stripe'})
    sessions = ((res.get('payment_collection') or {}).get('payment_sessions')) or []
    secret = (sessions[0].get('data') or {}).get('client_secret') if sessions else None

    if secret:
        pi = secret.split('_secret')[0]
        ok(f'PaymentIntent {pi} created')
        note('')
        note(f'{Y}Medusa\'s Stripe provider is PaymentIntents + Elements, not Checkout Sessions.{X}')
        note('That is a PCI scope decision — see research.md §5.1 and §7.5.')
        note('')
        note('To finish the proof, in two other terminals:')
        note(f'  stripe listen --forward-to localhost:9000/hooks/payment/stripe_stripe')
        note(f'  stripe payment_intents confirm {pi} --payment-method pm_card_visa')
        note('')
        note('Then, without opening a browser:')
        note(f'  python3 verify_flow.py --complete {cid}')
    else:
        bad('no client_secret returned')
        err = res.get('__error') or res
        print('     ', json.dumps(err)[:300] if isinstance(err, dict) else str(err)[:300])
        note('')
        note('Most likely STRIPE_API_KEY is empty in backend/.env.')
        note('Add your Stripe TEST secret key (sk_test_...) and restart the backend.')

    print(f'\n{B}cart id{X}  {cid}\n')


if __name__ == '__main__':
    main()
