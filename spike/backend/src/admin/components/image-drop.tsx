import { ArrowLongLeft, ArrowLongRight, ArrowUpTray, Spinner, Trash } from '@medusajs/icons'
import { Button, IconButton, Text, toast } from '@medusajs/ui'
import { useId, useRef, useState } from 'react'

/**
 * Drop images here, or click to choose them.
 *
 * Uploads go to `/admin/media/upload`, which runs the same pipeline as the import script —
 * WebP q78 capped at 1400px, hashed, stored once per distinct result. The component holds
 * only the returned `/media/<sha>.webp` URLs, never the bytes, so the parent form's state
 * stays small and a failed save loses nothing that was uploaded.
 *
 * **Content-addressing does the deduplication.** Dropping the same photo twice returns the
 * same URL, which is why a duplicate is reported as an already-attached image rather than
 * silently added again. A person will do this — it is the most common thing that happens to
 * a drop zone — and the alternative is two identical thumbnails and no explanation.
 *
 * Three accessibility details that are easy to get wrong here, and are the reason this is
 * not just a `<div onDrop>`:
 *
 *  1. **Drag and drop is not reachable from a keyboard at all.** So the zone contains a real
 *     `<button>` that opens the file picker, and that button — not the div — is what carries
 *     the label. Dropping is an enhancement on top of a control that works without it.
 *  2. **Reordering is buttons, not dragging.** Same reason. The order matters because the
 *     first image is the thumbnail, so it has to be changeable without a pointer.
 *  3. **Upload progress is announced.** A spinner that only appears visually leaves a screen
 *     reader user with no idea the drop did anything, so the status line is a live region.
 */
export type ImageDropProps = {
  value: string[]
  onChange: (urls: string[]) => void
  disabled?: boolean
}

type UploadResult = {
  uploaded: { filename: string; url: string; deduped: boolean }[]
  failed: { filename: string; error: string }[]
}

export default function ImageDrop({ value, onChange, disabled }: ImageDropProps) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(0)
  const [status, setStatus] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()

  const send = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return

    // Filtered here as well as server-side, so dropping a folder containing a PDF does not
    // spend an upload round trip to be told no.
    const images = list.filter((f) => f.type.startsWith('image/'))
    const skipped = list.length - images.length
    if (!images.length) {
      toast.error('No images in that drop', {
        description: 'Drop JPEG, PNG, WebP, AVIF, HEIF, TIFF or GIF files.',
      })
      return
    }

    const body = new FormData()
    for (const f of images) body.append('files', f)

    setBusy((n) => n + images.length)
    setStatus(`Uploading ${images.length} image${images.length === 1 ? '' : 's'}…`)
    try {
      const res = await fetch('/admin/media/upload', {
        method: 'POST', credentials: 'include', body,
      })
      // 207 is a mixed batch — some stored, some refused — and must not be read as failure.
      if (!res.ok && res.status !== 207) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message ?? `Upload failed (${res.status})`)
      }
      const data = (await res.json()) as UploadResult

      const added: string[] = []
      const already: string[] = []
      for (const u of data.uploaded) {
        if (value.includes(u.url) || added.includes(u.url)) already.push(u.filename)
        else added.push(u.url)
      }
      if (added.length) onChange([...value, ...added])

      for (const f of data.failed) {
        toast.error(f.filename, { description: f.error })
      }
      const parts = [
        added.length ? `${added.length} added` : '',
        already.length ? `${already.length} already attached` : '',
        skipped ? `${skipped} not an image` : '',
        data.failed.length ? `${data.failed.length} rejected` : '',
      ].filter(Boolean)
      setStatus(parts.join(', ') || 'Nothing to add')
    } catch (e) {
      toast.error('Upload failed', { description: (e as Error).message })
      setStatus('Upload failed')
    } finally {
      setBusy((n) => Math.max(0, n - images.length))
      // The same file has to be selectable twice in a row, and a file input does not fire
      // change when its value is unchanged.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return
    const next = [...value]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (!disabled) void send(e.dataTransfer.files)
        }}
        className={[
          'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed',
          'px-6 py-8 transition-colors',
          over ? 'border-ui-fg-interactive bg-ui-bg-highlight' : 'border-ui-border-strong',
          disabled ? 'opacity-50' : '',
        ].join(' ')}
      >
        {busy > 0 ? <Spinner className="animate-spin" /> : <ArrowUpTray />}
        <Text size="small" id={labelId}>
          Drag images here, or choose them
        </Text>
        <Button
          type="button"
          variant="secondary"
          size="small"
          disabled={disabled || busy > 0}
          onClick={() => inputRef.current?.click()}
        >
          Choose images
        </Button>
        <Text size="xsmall" className="text-ui-fg-subtle">
          JPEG, PNG, WebP, AVIF, HEIF or TIFF. Converted to WebP at up to 1400px.
        </Text>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          aria-labelledby={labelId}
          className="sr-only"
          onChange={(e) => e.target.files && void send(e.target.files)}
        />
      </div>

      {/* Announced rather than only shown — see the note at the top of this file. */}
      <Text size="xsmall" role="status" aria-live="polite" className="mt-2 block text-ui-fg-subtle">
        {status}
      </Text>

      {value.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3 p-0" style={{ listStyle: 'none' }}>
          {value.map((url, i) => (
            <li key={url} className="w-28">
              <div className="relative overflow-hidden rounded-md border border-ui-border-base">
                <img
                  src={`${url}?w=200`}
                  alt=""
                  className="block h-28 w-28 object-cover"
                />
                {i === 0 && (
                  <span className="absolute left-1 top-1 rounded bg-ui-bg-base px-1 text-xs">
                    Thumbnail
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between">
                <IconButton
                  type="button" size="small" variant="transparent"
                  disabled={disabled || i === 0}
                  aria-label={`Move image ${i + 1} earlier`}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowLongLeft />
                </IconButton>
                <IconButton
                  type="button" size="small" variant="transparent"
                  disabled={disabled || i === value.length - 1}
                  aria-label={`Move image ${i + 1} later`}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowLongRight />
                </IconButton>
                <IconButton
                  type="button" size="small" variant="transparent"
                  disabled={disabled}
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() => onChange(value.filter((v) => v !== url))}
                >
                  <Trash />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && (
        <Text size="xsmall" className="text-ui-fg-subtle">
          The first image is the thumbnail. Removing an image here detaches it from this
          jersey; the file itself is kept, because another product may use the same bytes.
        </Text>
      )}
    </div>
  )
}
