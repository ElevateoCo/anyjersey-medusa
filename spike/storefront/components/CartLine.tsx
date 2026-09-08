'use client'
import { useTransition } from 'react'
import { setQtyAction, removeLineAction } from '@/app/actions'
import type { GroupedLine } from '@/lib/line-groups'
import { money, mediaUrl } from '@/lib/medusa'

export default function CartLine({ line }: { line: GroupedLine }) {
  const [pending, start] = useTransition()
  const handle = line.variant?.product?.handle
  const addOns = line.addOns ?? []

  return (
    <tr style={{ opacity: pending ? 0.5 : 1 }}>
      <td style={{ width: 88 }}>
        {line.thumbnail
          ? <img src={mediaUrl(line.thumbnail, 200) ?? undefined} alt="" width={72} height={72}
                 style={{ objectFit: 'cover', background: 'var(--wash)' }} />
          : <div style={{ width: 72, height: 72, background: 'var(--wash)' }} />}
      </td>
      <td>
        <p className="t" style={{ margin: '0 0 .2rem' }}>
          {handle ? <a href={`/jerseys/${handle}`}>{line.title}</a> : line.title}
        </p>
        <p className="sub" style={{ margin: 0 }}>
          {line.variant?.title} · {line.variant?.sku ?? line.variant_sku}
        </p>
        {addOns.map((a) => (
          /* Shown as part of the shirt rather than as its own row: it is one physical item,
             and a standalone "Personalisation" line with its own Remove button would let a
             customer orphan the printing they paid for. */
          <p key={a.id} className="sub" style={{ margin: '.3rem 0 0', display: 'flex',
              gap: '.5rem', alignItems: 'baseline' }}>
            <span aria-hidden="true">↳</span>
            <span>{a.variant?.title ?? 'Personalisation'} — {money(a.subtotal)}</span>
          </p>
        ))}
        {addOns.length > 0 && (
          <p className="sub" style={{ margin: '.3rem 0 0', color: '#8A6D1F' }}>
            Made to order — not returnable or exchangeable.
          </p>
        )}
      </td>
      <td>
        <label className="visually-hidden" htmlFor={`qty-${line.id}`}>Quantity</label>
        <select id={`qty-${line.id}`} defaultValue={line.quantity} disabled={pending}
                onChange={(e) => start(() => setQtyAction(line.id, Number(e.target.value)).then())}
                style={{ padding: '.4rem', font: 'inherit' }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {/* The group total, so the number beside the shirt is what the shirt costs. */}
        {money(line.groupSubtotal ?? line.subtotal)}
      </td>
      <td style={{ textAlign: 'right' }}>
        <button disabled={pending}
                onClick={() => start(async () => {
                  // Remove the printing first: a shirt removed while its add-on remains
                  // leaves a charge for printing with nothing to print on.
                  for (const a of addOns) await removeLineAction(a.id)
                  await removeLineAction(line.id)
                })}
                style={{ background: 'none', border: 0, color: 'var(--ink-3)',
                         textDecoration: 'underline', fontSize: '.82rem' }}>
          Remove
        </button>
      </td>
    </tr>
  )
}
