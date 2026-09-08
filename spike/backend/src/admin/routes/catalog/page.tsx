import { defineRouteConfig } from '@medusajs/admin-sdk'
import { SquaresPlus } from '@medusajs/icons'
import {
  Badge, Button, Container, Heading, Input, Select, Table, Text, Textarea, toast,
} from '@medusajs/ui'
import { Fragment, useEffect, useState } from 'react'

/**
 * Catalog — the screen the built-in product list cannot be.
 *
 * Medusa's product list can display jersey_detail but silently ignores it as a filter:
 * asking for one team returns all 3,155 products. So this page exists to do four things
 * that had no home anywhere in the admin:
 *
 *   1. find products by team, league, colourway or free text
 *   2. work the needs_review queue
 *   3. edit the regulatory block, which gates EU sales
 *   4. apply the same regulatory values across a filtered set, since the answer is the
 *      same for the whole catalog
 *
 * Price is deliberately absent from the bulk panel — see the note at the bottom.
 */
type Product = {
  detail_id: string; product_id: string | null; handle: string; title: string | null
  status: string | null; thumbnail: string | null
  team: string | null; league: string | null; player: string | null
  colourway: string | null; season: string | null; garment: string | null
  needs_review: boolean; review_notes: string[] | null
  regulatory: Record<string, string | null>
  missing_regulatory: string[]
  eu_ready: boolean
}
type Facet = { value: string; count: number }
type Payload = {
  count: number; limit: number; offset: number
  products: Product[]
  facets: { leagues: Facet[]; teams: Facet[]; colourways: Facet[]; garments: Facet[] }
  health: { total: number; needs_review: number; eu_ready: number; missing_regulatory: number }
  editable_regulatory_fields: string[]
}

const LABELS: Record<string, string> = {
  fibre_composition: 'Fibre composition',
  country_of_origin: 'Country of origin (ISO-2)',
  eu_responsible_person: 'EU responsible person',
  manufacturer_name: 'Manufacturer',
  manufacturer_address: 'Manufacturer address',
  care_instructions: 'Care instructions',
  safety_information: 'Safety information',
  hs_code: 'HS code',
}
const ANY = '__any__'

export default function CatalogPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [team, setTeam] = useState(ANY)
  const [league, setLeague] = useState(ANY)
  const [needsReview, setNeedsReview] = useState(false)
  const [missingReg, setMissingReg] = useState(false)
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [bulk, setBulk] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{ would_update: number } | null>(null)
  const limit = 25

  const params = () => {
    const p = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (q.trim()) p.set('q', q.trim())
    if (team !== ANY) p.set('team', team)
    if (league !== ANY) p.set('league', league)
    if (needsReview) p.set('needs_review', 'true')
    if (missingReg) p.set('missing_regulatory', 'true')
    return p
  }

  const load = () => {
    setLoading(true)
    fetch(`/admin/catalog?${params()}`, { credentials: 'include' })
      .then((r) => r.json()).then(setData).finally(() => setLoading(false))
  }
  useEffect(load, [team, league, needsReview, missingReg, offset])

  async function saveRow(id: string) {
    const res = await fetch(`/admin/catalog/${id}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    const body = await res.json()
    if (res.ok) { toast.success('Saved'); setEditing(null); setDraft({}); load() }
    else toast.error(body.message ?? 'Could not save')
  }

  async function runBulk(apply: boolean) {
    const filter: Record<string, string> = {}
    if (team !== ANY) filter.team = team
    if (league !== ANY) filter.league = league
    if (needsReview) filter.needs_review = 'true'
    if (missingReg) filter.missing_regulatory = 'true'
    if (q.trim()) filter.q = q.trim()

    const res = await fetch('/admin/catalog/bulk', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter, set: bulk, apply }),
    })
    const body = await res.json()
    if (!res.ok) return toast.error(body.message ?? 'Failed')
    if (apply) {
      toast.success(`Updated ${body.updated} product(s)`)
      setPreview(null); setBulk({}); load()
    } else {
      setPreview({ would_update: body.would_update })
    }
  }

  const h = data?.health
  const pages = data ? Math.ceil(data.count / limit) : 0
  const page = Math.floor(offset / limit) + 1

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Catalog</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Find products by team or league, work the review queue, and fill the regulatory
          fields that gate EU sales
        </Text>
      </div>

      {h && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ui-border-base">
          {[
            { label: 'Products', value: h.total.toLocaleString() },
            { label: 'Needs review', value: h.needs_review.toLocaleString() },
            { label: 'EU-sellable', value: h.eu_ready.toLocaleString() },
            { label: 'Missing regulatory', value: h.missing_regulatory.toLocaleString() },
          ].map((t) => (
            <div key={t.label} className="bg-ui-bg-base px-6 py-4">
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">
                {t.label}
              </Text>
              <Heading level="h2" className="tabular-nums mt-1">{t.value}</Heading>
            </div>
          ))}
        </div>
      )}

      {/* filters in one row above the table */}
      <div className="flex flex-wrap gap-2 items-center px-6 py-4">
        <Input placeholder="Player, team, colour…" value={q} className="w-56"
               onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') { setOffset(0); load() } }} />
        <Select value={league} onValueChange={(v) => { setLeague(v); setOffset(0) }}>
          <Select.Trigger className="w-40"><Select.Value placeholder="League" /></Select.Trigger>
          <Select.Content>
            <Select.Item value={ANY}>All leagues</Select.Item>
            {(data?.facets.leagues ?? []).map((f) => (
              <Select.Item key={f.value} value={f.value}>{f.value} ({f.count})</Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Select value={team} onValueChange={(v) => { setTeam(v); setOffset(0) }}>
          <Select.Trigger className="w-56"><Select.Value placeholder="Team" /></Select.Trigger>
          <Select.Content>
            <Select.Item value={ANY}>All teams</Select.Item>
            {(data?.facets.teams ?? []).map((f) => (
              <Select.Item key={f.value} value={f.value}>{f.value} ({f.count})</Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Button size="small" variant={needsReview ? 'primary' : 'secondary'}
                onClick={() => { setNeedsReview((v) => !v); setOffset(0) }}>
          Needs review{h ? ` (${h.needs_review})` : ''}
        </Button>
        <Button size="small" variant={missingReg ? 'primary' : 'secondary'}
                onClick={() => { setMissingReg((v) => !v); setOffset(0) }}>
          Missing regulatory{h ? ` (${h.missing_regulatory})` : ''}
        </Button>
        {(q || team !== ANY || league !== ANY || needsReview || missingReg) && (
          <Button size="small" variant="transparent" onClick={() => {
            setQ(''); setTeam(ANY); setLeague(ANY); setNeedsReview(false)
            setMissingReg(false); setOffset(0)
          }}>Clear</Button>
        )}
      </div>

      {/* bulk panel — operates on exactly the current filter */}
      <div className="px-6 py-4 bg-ui-bg-subtle">
        <Heading level="h3" className="mb-1">Apply to everything matching this filter</Heading>
        <Text size="small" className="text-ui-fg-subtle mb-3">
          {data ? `${data.count.toLocaleString()} product(s) currently match.` : '—'} The
          regulatory answer is the same for the whole catalog, so this is how 3,155 rows get
          filled from one supplier reply.
        </Text>
        <div className="grid md:grid-cols-3 gap-3">
          {['fibre_composition', 'country_of_origin', 'eu_responsible_person'].map((f) => (
            <div key={f}>
              <Text size="xsmall" className="text-ui-fg-muted">{LABELS[f]}</Text>
              <Input value={bulk[f] ?? ''} placeholder={f === 'country_of_origin' ? 'cn' : ''}
                     onChange={(e) => { setBulk({ ...bulk, [f]: e.target.value }); setPreview(null) }} />
            </div>
          ))}
          <div className="md:col-span-2">
            <Text size="xsmall" className="text-ui-fg-muted">{LABELS.care_instructions}</Text>
            <Textarea rows={2} value={bulk.care_instructions ?? ''}
                      onChange={(e) => { setBulk({ ...bulk, care_instructions: e.target.value }); setPreview(null) }} />
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">{LABELS.hs_code}</Text>
            <Input value={bulk.hs_code ?? ''} placeholder="6109.10"
                   onChange={(e) => { setBulk({ ...bulk, hs_code: e.target.value }); setPreview(null) }} />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <Button size="small" variant="secondary"
                  disabled={!Object.values(bulk).some((v) => v?.trim())}
                  onClick={() => runBulk(false)}>Preview</Button>
          <Button size="small" disabled={!preview} onClick={() => runBulk(true)}>
            {preview ? `Apply to ${preview.would_update.toLocaleString()}` : 'Apply'}
          </Button>
          {preview && (
            <Text size="small" className="text-ui-fg-subtle">
              Nothing has changed yet.
            </Text>
          )}
        </div>
      </div>

      <div className="px-6 py-4">
        {loading ? (
          <Text size="small" className="text-ui-fg-muted">Loading…</Text>
        ) : !data?.products.length ? (
          <Text size="small" className="text-ui-fg-muted">Nothing matches.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Product</Table.HeaderCell>
                <Table.HeaderCell>Taxonomy</Table.HeaderCell>
                <Table.HeaderCell>EU</Table.HeaderCell>
                <Table.HeaderCell>Review</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.products.map((p) => (
                <Fragment key={p.detail_id}>
                  <Table.Row>
                    <Table.Cell className="max-w-xs">
                      <Text size="small" className="truncate">{p.title ?? p.handle}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small" className="text-ui-fg-subtle">
                        {[p.league, p.team, p.player, p.colourway].filter(Boolean).join(' · ') || '—'}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {p.eu_ready
                        ? <Badge size="small" color="green">ready</Badge>
                        : <Badge size="small" color="red">{p.missing_regulatory.length} missing</Badge>}
                    </Table.Cell>
                    <Table.Cell>
                      {p.needs_review
                        ? <Badge size="small" color="orange">flagged</Badge>
                        : <Text size="xsmall" className="text-ui-fg-muted">—</Text>}
                    </Table.Cell>
                    <Table.Cell>
                      <Button size="small" variant="transparent" onClick={() => {
                        const open = editing === p.detail_id
                        setEditing(open ? null : p.detail_id)
                        setDraft(open ? {} : {
                          team: p.team ?? '', player: p.player ?? '',
                          colourway: p.colourway ?? '',
                          ...Object.fromEntries(
                            Object.entries(p.regulatory).map(([k, v]) => [k, v ?? ''])
                          ),
                        })
                      }}>
                        {editing === p.detail_id ? 'Close' : 'Edit'}
                      </Button>
                    </Table.Cell>
                  </Table.Row>

                  {editing === p.detail_id && (
                    <Table.Row>
                      {/* Medusa's Table.Cell does not type colSpan; the underlying
                          element is a real <td>, so use one directly. */}
                      <td colSpan={5} className="px-4">
                        <div className="grid md:grid-cols-3 gap-3 py-2">
                          {['team', 'player', 'colourway',
                            ...(data.editable_regulatory_fields ?? [])].map((f) => (
                            <div key={f}>
                              <Text size="xsmall" className="text-ui-fg-muted">
                                {LABELS[f] ?? f}
                              </Text>
                              <Input value={draft[f] ?? ''}
                                     onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 pb-2">
                          <Button size="small" onClick={() => saveRow(p.detail_id)}>Save</Button>
                          {p.needs_review && (
                            <Button size="small" variant="secondary" onClick={() => {
                              setDraft({ ...draft, needs_review: 'false' as never })
                              saveRow(p.detail_id)
                            }}>Save and clear flag</Button>
                          )}
                        </div>
                      </td>
                    </Table.Row>
                  )}
                </Fragment>
              ))}
            </Table.Body>
          </Table>
        )}

        {data && pages > 1 && (
          <div className="flex items-center gap-3 mt-4">
            <Button size="small" variant="secondary" disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}>← Prev</Button>
            <Text size="small" className="text-ui-fg-subtle">
              Page {page} of {pages} — {data.count.toLocaleString()} product(s)
            </Text>
            <Button size="small" variant="secondary" disabled={offset + limit >= data.count}
                    onClick={() => setOffset(offset + limit)}>Next →</Button>
          </div>
        )}
      </div>

      <div className="px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          Price is deliberately not bulk-editable here. Changing it across the catalog has
          reference-pricing consequences under the Omnibus Directive and FTC guidance
          (research.md §7.10) — that belongs in a considered decision with the prior price
          recorded, not behind a button on an admin screen.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({ label: 'Catalog', icon: SquaresPlus })
