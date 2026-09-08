import { defineRouteConfig } from '@medusajs/admin-sdk'
import { Tag } from '@medusajs/icons'
import {
  Badge, Button, Container, FocusModal, Heading, Input, Prompt, Table, Text, toast,
} from '@medusajs/ui'
import { useCallback, useEffect, useState } from 'react'
import JerseyForm, { emptyDraft, type JerseyDraft } from '../../components/jersey-form'

/**
 * Jerseys — create, edit and delete, with images.
 *
 * This is the screen the admin did not have. To be exact about what was missing before it,
 * because "Medusa has a product page" is true and not the whole story:
 *
 *  - The stock product screen creates a Medusa product with **no `jersey_detail`**. That
 *    row is what carries team, league, player, colourway and `search_text`, and
 *    `/store/jerseys` filters *through* the product↔detail link — so a product created
 *    there is in no facet, no league listing, no team listing and no search result. It
 *    looks completely healthy in the admin and does not exist to a customer.
 *  - The stock product screen cannot upload an image, at all. Uploads go through Medusa's
 *    **File module**, and this project registers none — the module has no default, so the
 *    control has nothing behind it. Every image in the catalogue arrived through
 *    `scripts/ingest-media.ts`, from a folder on a laptop.
 *  - `/admin/catalog` can edit the regulatory block and the taxonomy of a product that
 *    already exists. It cannot create one and cannot delete one.
 *
 * So this screen owns the whole lifecycle, and the two halves are written in one call so
 * they cannot drift apart. Listing and filtering stay on `/admin/catalog`, which already
 * does that better than this page would.
 */
export const config = defineRouteConfig({ label: 'Jerseys', icon: Tag })

type Row = {
  detail_id: string
  product_id: string | null
  handle: string
  title: string | null
  status: string | null
  thumbnail: string | null
  team: string | null
  league: string | null
  player: string | null
  needs_review: boolean
}
type ListPayload = { count: number; limit: number; offset: number; products: Row[] }
type Defaults = { default_sizes: string[]; default_price: number; custom_price: number }

const LIMIT = 20

export default function JerseysPage() {
  const [data, setData] = useState<ListPayload | null>(null)
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'edit'>('create')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<JerseyDraft>(emptyDraft())
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) })
    if (q.trim()) p.set('q', q.trim())
    fetch(`/admin/catalog?${p}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error('Could not load the catalog'))
      .finally(() => setLoading(false))
  }, [offset, q])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/admin/jerseys', { credentials: 'include' })
      .then((r) => r.json())
      .then(setDefaults)
      .catch(() => undefined)
  }, [])

  const sizeOptions = defaults?.default_sizes ?? ['S', 'M', 'L', 'XL', '2XL', '3XL']

  const startCreate = () => {
    setMode('create')
    setEditingId(null)
    setDraft(emptyDraft(String(defaults?.default_price ?? '65.99'), [...sizeOptions]))
    setOpen(true)
  }

  const startEdit = async (row: Row) => {
    if (!row.product_id) {
      return toast.error('This catalog row has no product attached', {
        description: 'It cannot be edited here. See the catalog screen.',
      })
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/admin/jerseys/${row.product_id}`, { credentials: 'include' })
      if (!res.ok) throw new Error((await res.json()).message ?? 'Could not load it')
      const j = await res.json()
      const d = j.detail ?? {}
      setDraft({
        title: j.title ?? '',
        handle: j.handle ?? '',
        description: j.description ?? '',
        price: j.price != null ? String(j.price) : '',
        status: j.status === 'published' ? 'published' : 'draft',
        sizes: j.sizes ?? [],
        images: j.images ?? [],
        team: d.team ?? '', league: d.league ?? '', player: d.player ?? '',
        colourway: d.colourway ?? '', season: d.season ?? '',
        garment: d.garment ?? 'jersey', sport: d.sport ?? '',
        seo_title: d.seo_title ?? '', seo_description: d.seo_description ?? '',
        is_custom: !!d.is_custom, needs_review: !!d.needs_review,
      })
      setMode('edit')
      setEditingId(row.product_id)
      setOpen(true)
      if (!j.storefront_visible) {
        toast.warning('This product has no catalog row', {
          description: 'It is invisible to the storefront until one exists.',
        })
      }
    } catch (e) {
      toast.error('Could not open that jersey', { description: (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const save = async () => {
    setSubmitting(true)
    // `sizes` is deliberately absent from the edit payload. Changing a size run means
    // adding and removing variants that may already be on an order, which is a different
    // operation from editing a product and does not belong behind the same Save button.
    const body: Record<string, unknown> = {
      title: draft.title, handle: draft.handle, description: draft.description,
      price: draft.price, status: draft.status, images: draft.images,
      team: draft.team, league: draft.league, player: draft.player,
      colourway: draft.colourway, season: draft.season, garment: draft.garment,
      sport: draft.sport, seo_title: draft.seo_title,
      seo_description: draft.seo_description,
      is_custom: draft.is_custom, needs_review: draft.needs_review,
      ...(mode === 'create' ? { sizes: draft.sizes } : {}),
    }
    try {
      const url = mode === 'create' ? '/admin/jerseys' : `/admin/jerseys/${editingId}`
      const res = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message ?? `Save failed (${res.status})`)
      toast.success(mode === 'create' ? 'Jersey created' : 'Jersey saved', {
        description: json.handle ? `/jerseys/${json.handle}` : undefined,
      })
      setOpen(false)
      load()
    } catch (e) {
      toast.error('Not saved', { description: (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (row: Row) => {
    setConfirmDelete(null)
    try {
      const res = await fetch(`/admin/jerseys/${row.product_id}`, {
        method: 'DELETE', credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message ?? `Delete failed (${res.status})`)
      toast.success('Jersey deleted', { description: 'Its images were kept.' })
      load()
    } catch (e) {
      toast.error('Not deleted', { description: (e as Error).message })
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Jerseys</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Create, edit and delete a product and its catalog row together.
          </Text>
        </div>
        <Button onClick={startCreate}>New jersey</Button>
      </div>

      <div className="px-6 py-3">
        <Input
          placeholder="Search by team, player or title"
          value={q}
          onChange={(e) => { setOffset(0); setQ(e.target.value) }}
        />
      </div>

      <div className="px-6 py-2">
        {loading && !data ? (
          <Text className="py-8 text-center text-ui-fg-subtle">Loading…</Text>
        ) : !data?.products.length ? (
          <Text className="py-8 text-center text-ui-fg-subtle">
            Nothing matches. <Button variant="transparent" onClick={startCreate}>
              Create the first one
            </Button>
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell />
                <Table.HeaderCell>Title</Table.HeaderCell>
                <Table.HeaderCell>Team</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.products.map((row) => (
                <Table.Row key={row.detail_id}>
                  <Table.Cell>
                    {row.thumbnail
                      ? <img src={`${row.thumbnail}?w=200`} alt=""
                             className="h-10 w-10 rounded object-cover" />
                      : <div className="h-10 w-10 rounded bg-ui-bg-component" />}
                  </Table.Cell>
                  <Table.Cell>
                    <div>{row.title ?? row.handle}</div>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {[row.player, row.league].filter(Boolean).join(' · ')}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>{row.team ?? '—'}</Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall"
                           color={row.status === 'published' ? 'green' : 'grey'}>
                      {row.status ?? 'no product'}
                    </Badge>
                    {row.needs_review && (
                      <Badge size="2xsmall" color="orange" className="ml-1">review</Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex justify-end gap-2">
                      <Button size="small" variant="secondary"
                              onClick={() => startEdit(row)}>Edit</Button>
                      <Button size="small" variant="danger"
                              disabled={!row.product_id}
                              onClick={() => setConfirmDelete(row)}>Delete</Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-3">
        <Text size="small" className="text-ui-fg-subtle">
          {data ? `${offset + 1}–${Math.min(offset + LIMIT, data.count)} of ${data.count}` : ''}
        </Text>
        <div className="flex gap-2">
          <Button size="small" variant="secondary" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</Button>
          <Button size="small" variant="secondary"
                  disabled={!data || offset + LIMIT >= data.count}
                  onClick={() => setOffset(offset + LIMIT)}>Next</Button>
        </div>
      </div>

      <FocusModal open={open} onOpenChange={setOpen}>
        <FocusModal.Content>
          <FocusModal.Header>
            <Heading level="h2">
              {mode === 'create' ? 'New jersey' : 'Edit jersey'}
            </Heading>
          </FocusModal.Header>
          <FocusModal.Body className="overflow-y-auto p-6">
            <div className="mx-auto w-full max-w-3xl">
              <JerseyForm
                draft={draft} setDraft={setDraft} sizeOptions={sizeOptions}
                onSubmit={save} submitting={submitting} mode={mode}
              />
            </div>
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>

      <Prompt open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Delete this jersey?</Prompt.Title>
            <Prompt.Description>
              {confirmDelete?.title ?? confirmDelete?.handle} will be removed from the
              storefront. The product and its catalog row are soft-deleted, so this can be
              undone in the database; the images are kept, because another product may use
              the same bytes.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            <Prompt.Action onClick={() => confirmDelete && remove(confirmDelete)}>
              Delete
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </Container>
  )
}
