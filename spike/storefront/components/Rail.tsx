import { teamColour, readableInk, hasTeamColour } from '@/lib/team-colors'

/**
 * Band D — the "who" rail.
 *
 * One component, one data shape, four fillings. The reference puts official club crests
 * here; §7 rules those out, so the disc carries the team's **colours** with its initials
 * over them. A colour pair is not a mark — every scoreboard and newspaper denotes a club
 * this way — and it gives the row the same instant scan without claiming a licence we do
 * not hold.
 *
 * The rail is context-dependent by design, which is what stops this becoming four
 * components: the homepage fills it with the biggest teams across every sport, a sport
 * listing fills it with that sport's teams, and the MMA range — which has no teams at all,
 * only fighters — fills it with athletes. `kind` only changes the fallback colour and the
 * label wording; the markup is identical.
 */
export type RailItem = { label: string; href: string; count?: number }

/**
 * "Team Netherlands" and "Team USA" are how the catalogue names international sides, and
 * the "Team" prefix carries no information once twelve discs all start with a T — so it
 * goes before the letters are taken. Two words give first-and-last initials, which is what
 * makes "Sean O' Malley" read as SM rather than SE.
 */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => w && w.toLowerCase() !== 'team')
  if (words.length === 0) return name.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export default function Rail({ title, seeAll, items, kind = 'team' }: {
  title: string
  seeAll?: { label: string; href: string }
  items: RailItem[]
  kind?: 'team' | 'athlete'
}) {
  if (!items.length) return null
  return (
    <section className="band railband">
      <div className="wrap">
        <div className="sechead">
          <h2>{title}</h2>
          {seeAll && <a href={seeAll.href}>{seeAll.label}</a>}
        </div>
        <ul className="rail">
          {items.map((it, i) => {
            const c = teamColour(it.label)
            const ink = readableInk(c.primary)
            return (
              <li key={it.href}>
                <a
                  className="railtile"
                  href={it.href}
                  // A team the colour map does not name gets a deterministic fallback
                  // rather than a random one, so the rail looks identical on the server
                  // and after hydration. Said out loud here because a hydration mismatch
                  // in a colour is invisible until somebody screenshots it twice.
                  data-known={kind === 'team' && hasTeamColour(it.label) ? 'yes' : 'no'}
                >
                  <span
                    className="raildisc"
                    aria-hidden="true"
                    style={{
                      background: c.primary,
                      color: ink,
                      // The secondary is the ring, not the fill: two flat colours in one
                      // 78px circle read as a pie chart rather than as a club.
                      boxShadow: `inset 0 0 0 3px ${c.secondary}`,
                    }}
                  >
                    {initials(it.label)}
                  </span>
                  <span className="raillabel">{it.label}</span>
                  {it.count !== undefined && (
                    <span className="railn">
                      {it.count} {it.count === 1 ? 'item' : 'items'}
                    </span>
                  )}
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
