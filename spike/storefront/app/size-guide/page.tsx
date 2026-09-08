import Prose from '@/components/Prose'
import { MEASUREMENTS, SIZE_GUIDE } from '@/lib/content'
import { abs } from '@/lib/site'

export const metadata = {
  title: SIZE_GUIDE.title,
  description: SIZE_GUIDE.summary,
  alternates: { canonical: abs('/size-guide') },
}

/**
 * The measurements table.
 *
 * Rendered from `MEASUREMENTS`, which is empty until the supplier sends chest and length
 * figures. The empty state is the point: it names what is missing and what it blocks,
 * rather than filling the space with a generic apparel chart. On a store that pays for
 * size exchanges, a wrong measurement is not a cosmetic gap — it is a return we funded.
 */
export default function SizeGuidePage() {
  return (
    <Prose doc={SIZE_GUIDE}>
      <div className="psec">
        <h2>Measurements</h2>
        {MEASUREMENTS.length > 0 ? (
          <table className="spec wide">
            <caption className="visually-hidden">
              Chest and length in inches, measured flat
            </caption>
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col">Chest (in, flat)</th>
                <th scope="col">Length (in)</th>
              </tr>
            </thead>
            <tbody>
              {MEASUREMENTS.map((m) => (
                <tr key={m.size}>
                  <th scope="row">{m.size}</th>
                  <td>{m.chest ?? '—'}</td>
                  <td>{m.length ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="entity">
            <p className="callout warn">
              <strong>We do not have the numbers yet.</strong> Chest and length
              measurements come from the supplier, and until they arrive we would rather
              show nothing than publish a generic apparel chart. A wrong measurement on a
              shop that pays for size exchanges is a return we funded, not a formatting
              problem.
            </p>
            <p className="note">
              In the meantime: the guidance below is accurate, and a size exchange costs you
              nothing. If you tell us the chest measurement of a shirt that fits you, we
              will match it by hand before dispatch.
            </p>
          </div>
        )}
      </div>
    </Prose>
  )
}
