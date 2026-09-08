import { Button, Input, Label, Select, Switch, Text, Textarea, toast } from '@medusajs/ui'
import { useEffect, useState } from 'react'
import ImageDrop from './image-drop'

/**
 * Create or edit one jersey — the Medusa product and its `jersey_detail` in one form.
 *
 * The two halves are shown together because they are one thing to whoever is filling this
 * in, and because separating them is what produces the failure this screen exists to
 * prevent: a product created on the stock Medusa screen has no detail row, so it has no
 * team, no league and no `search_text`, and is invisible to every storefront listing while
 * looking perfectly healthy in the admin.
 *
 * `handle` follows the title until somebody edits it, and then stops. Auto-generating it
 * forever means renaming a published jersey silently changes its URL and drops whatever
 * rank it had; never generating it means typing a slug by hand for every new product.
 */
export type JerseyDraft = {
  title: string
  handle: string
  description: string
  price: string
  status: 'draft' | 'published'
  sizes: string[]
  images: string[]
  team: string
  league: string
  player: string
  colourway: string
  season: string
  garment: string
  sport: string
  seo_title: string
  seo_description: string
  is_custom: boolean
  needs_review: boolean
}

export const emptyDraft = (price = '65.99', sizes: string[] = []): JerseyDraft => ({
  title: '', handle: '', description: '', price, status: 'draft',
  sizes, images: [],
  team: '', league: '', player: '', colourway: '', season: '',
  garment: 'jersey', sport: '',
  seo_title: '', seo_description: '',
  is_custom: false, needs_review: false,
})

const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120).replace(/-+$/, '')

const FIELDS: [keyof JerseyDraft, string, string][] = [
  ['team', 'Team', 'Dallas Cowboys'],
  ['player', 'Player', 'Dak Prescott'],
  ['league', 'League', 'NFL'],
  ['sport', 'Sport', 'football'],
  ['colourway', 'Colour', 'white'],
  ['season', 'Season', '2026'],
  ['garment', 'Garment', 'jersey'],
]

export default function JerseyForm({
  draft, setDraft, sizeOptions, onSubmit, submitting, mode,
}: {
  draft: JerseyDraft
  setDraft: (d: JerseyDraft) => void
  sizeOptions: string[]
  onSubmit: () => void
  submitting: boolean
  mode: 'create' | 'edit'
}) {
  const [handleTouched, setHandleTouched] = useState(mode === 'edit')

  useEffect(() => {
    if (handleTouched) return
    const next = slugify(draft.title)
    if (next !== draft.handle) setDraft({ ...draft, handle: next })
    // Only the title drives this; including `draft` would fight the user's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.title, handleTouched])

  const set = <K extends keyof JerseyDraft>(k: K, v: JerseyDraft[K]) =>
    setDraft({ ...draft, [k]: v })

  const toggleSize = (size: string) => {
    const has = draft.sizes.includes(size)
    // Kept in the catalogue's order rather than click order, so the size run reads S, M, L
    // on the storefront regardless of the order they were ticked in.
    const next = has
      ? draft.sizes.filter((s) => s !== size)
      : sizeOptions.filter((s) => draft.sizes.includes(s) || s === size)
    set('sizes', next)
  }

  const submit = () => {
    if (!draft.title.trim()) return toast.error('A title is required')
    if (!draft.handle.trim()) return toast.error('A handle is required')
    if (!draft.sizes.length) return toast.error('Pick at least one size')
    if (draft.status === 'published' && !draft.images.length) {
      // Refused rather than warned: a published jersey with no image is a live product page
      // with an empty gallery, and the storefront has no placeholder worth showing.
      return toast.error('A published jersey needs at least one image', {
        description: 'Save it as a draft, or add an image first.',
      })
    }
    onSubmit()
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="j-title">Title</Label>
          <Input id="j-title" value={draft.title} disabled={submitting}
                 placeholder="Dallas Cowboys Dak Prescott White Jersey"
                 onChange={(e) => set('title', e.target.value)} />
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="j-handle">Web address</Label>
          <Input id="j-handle" value={draft.handle} disabled={submitting}
                 onChange={(e) => { setHandleTouched(true); set('handle', e.target.value) }} />
          <Text size="xsmall" className="text-ui-fg-subtle">
            /jerseys/{draft.handle || '…'}
            {mode === 'edit' ? ' — changing this breaks existing links to the product.' : ''}
          </Text>
        </div>

        <div>
          <Label htmlFor="j-price">Price (USD)</Label>
          <Input id="j-price" value={draft.price} disabled={submitting} inputMode="decimal"
                 onChange={(e) => set('price', e.target.value)} />
          <Text size="xsmall" className="text-ui-fg-subtle">
            Applies to every size. The catalogue is one price per product.
          </Text>
        </div>

        <div>
          <Label htmlFor="j-status">Status</Label>
          <Select value={draft.status} disabled={submitting}
                  onValueChange={(v) => set('status', v as 'draft' | 'published')}>
            <Select.Trigger id="j-status"><Select.Value /></Select.Trigger>
            <Select.Content>
              <Select.Item value="draft">Draft — not on the storefront</Select.Item>
              <Select.Item value="published">Published — live</Select.Item>
            </Select.Content>
          </Select>
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="j-desc">Description</Label>
          <Textarea id="j-desc" rows={4} value={draft.description} disabled={submitting}
                    onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>

      <fieldset className="border-0 p-0 m-0">
        <legend><Label>Sizes</Label></legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {sizeOptions.map((s) => {
            const on = draft.sizes.includes(s)
            return (
              <Button key={s} type="button" size="small" disabled={submitting}
                      variant={on ? 'primary' : 'secondary'}
                      aria-pressed={on}
                      onClick={() => toggleSize(s)}>
                {s}
              </Button>
            )
          })}
        </div>
        <Text size="xsmall" className="mt-1 block text-ui-fg-subtle">
          One variant per size, never stock tracked — nothing here can sell out.
          {mode === 'edit' ? ' Sizes cannot be changed after creation.' : ''}
        </Text>
      </fieldset>

      <div>
        <Label>Images</Label>
        <ImageDrop value={draft.images} disabled={submitting}
                   onChange={(images) => set('images', images)} />
      </div>

      <div>
        <Label>Catalog fields</Label>
        <Text size="xsmall" className="mb-2 block text-ui-fg-subtle">
          These drive the facets, the league and team listings, and free-text search. A
          jersey with no team appears in no team listing.
        </Text>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {FIELDS.map(([key, label, placeholder]) => (
            <div key={key}>
              <Label htmlFor={`j-${key}`}>{label}</Label>
              <Input id={`j-${key}`} value={String(draft[key] ?? '')} disabled={submitting}
                     placeholder={placeholder}
                     onChange={(e) => set(key, e.target.value as never)} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="j-seot">SEO title</Label>
          <Input id="j-seot" value={draft.seo_title} disabled={submitting}
                 onChange={(e) => set('seo_title', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="j-seod">SEO description</Label>
          <Input id="j-seod" value={draft.seo_description} disabled={submitting}
                 onChange={(e) => set('seo_description', e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Switch id="j-custom" checked={draft.is_custom} disabled={submitting}
                  onCheckedChange={(v) => set('is_custom', v)} />
          <Label htmlFor="j-custom">
            Custom blank — printing included, sold at the custom price
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="j-review" checked={draft.needs_review} disabled={submitting}
                  onCheckedChange={(v) => set('needs_review', v)} />
          <Label htmlFor="j-review">Flag for review</Label>
        </div>
      </div>

      <div>
        <Button type="submit" isLoading={submitting}>
          {mode === 'create' ? 'Create jersey' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
