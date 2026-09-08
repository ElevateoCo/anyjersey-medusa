'use client'
import { useState } from 'react'
import CartDrawer from './CartDrawer'

/** Header bag control — opens the drawer rather than navigating away. */
export default function CartButton({ count, data }: {
  count: number
  data: Parameters<typeof CartDrawer>[0]['data']
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="cartlink" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Bag{count > 0 && <b>{count}</b>}
        <span className="visually-hidden">
          {count === 1 ? ', 1 item' : `, ${count} items`}
        </span>
      </button>
      <CartDrawer open={open} onClose={() => setOpen(false)} data={data} />
    </>
  )
}
