import type { Block, Doc, Section } from '@/lib/prose'
import { ENTITY } from '@/lib/site'

/**
 * Renders a written page.
 *
 * The interesting part is `pending`. When a section depends on an entity detail nobody has
 * filled in, this prints a labelled gap naming the field and why it is required, instead of
 * either omitting the disclosure or inventing a value. That is the §13.5 pattern — the one
 * the product page already uses for the regulatory block — applied to legal copy, where
 * the consequence of a plausible-looking guess is worse.
 *
 * Heading levels are fixed here rather than chosen per document: the page owns the h1 and
 * every section is an h2, so heading order cannot jump. The a11y audit checks for exactly
 * that, and it was previously guaranteed only by whoever wrote the markup being careful.
 */
function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if ('p' in b) return <p key={i}>{b.p}</p>
        if ('ul' in b) {
          return <ul key={i} className="bullets">{b.ul.map((t, j) => <li key={j}>{t}</li>)}</ul>
        }
        if ('ol' in b) {
          return <ol key={i} className="bullets">{b.ol.map((t, j) => <li key={j}>{t}</li>)}</ol>
        }
        if ('rows' in b) {
          return (
            <table key={i} className="spec wide">
              <tbody>
                {b.rows.map(([k, v]) => (
                  <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          )
        }
        if ('note' in b) {
          return (
            <p key={i} className={b.tone === 'warn' ? 'callout warn' : 'callout'}>{b.note}</p>
          )
        }
        // 'pending'
        const fields = b.pending
          .map((k) => ENTITY.find((e) => e.key === k))
          .filter((e): e is (typeof ENTITY)[number] => !!e)
        const missing = fields.filter((f) => !f.value)
        return (
          <div key={i} className="entity">
            <table className="spec wide">
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key}>
                    <th scope="row">{f.label}</th>
                    <td>
                      {f.value
                        ? f.value
                        : <span className="gap">Not yet appointed &mdash; {f.why}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {missing.length > 0 && (
              <p className="note">
                {missing.length} of {fields.length} required{' '}
                {fields.length === 1 ? 'detail' : 'details'} in this section{' '}
                {missing.length === 1 ? 'is' : 'are'} outstanding. Each one is a disclosure
                the law requires, so it is shown as a gap rather than left blank.
              </p>
            )}
          </div>
        )
      })}
    </>
  )
}

export default function Prose({ doc, children }: { doc: Doc; children?: React.ReactNode }) {
  return (
    <section className="band">
      <div className="wrap prose">
        <p className="eyebrow">{doc.legal ? 'Legal' : 'Help'}</p>
        <h1>{doc.title}</h1>
        <p className="standfirst">{doc.summary}</p>

        {doc.legal && (
          <p className="callout warn">
            <strong>Draft, pending legal review.</strong> This document states commitments
            we intend to keep, but it has not been reviewed by a lawyer and must be before
            the shop takes real orders. A refund policy is a contract term; publishing an
            unreviewed one as settled is the same class of error as showing a comparison
            price that was never charged.
          </p>
        )}

        {children}

        {doc.sections.map((s: Section) => (
          <div key={s.title} className="psec">
            <h2>{s.title}</h2>
            <Blocks blocks={s.blocks} />
          </div>
        ))}

        <p className="note updated">
          Last updated{' '}
          <time dateTime={doc.updated}>
            {new Date(doc.updated + 'T00:00:00Z').toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
            })}
          </time>
        </p>
      </div>
    </section>
  )
}
