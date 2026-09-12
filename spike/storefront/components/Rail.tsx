import { teamColour, readableInk, hasTeamColour } from '@/lib/team-colors'
import { mediaUrl } from '@/lib/medusa'

/**
 * Band D — the "who" rail.
 *
 * One component, one data shape, four fillings.
 *
 * **The tile is a photograph of our own stock, cropped to a circle.** That is what
 * `layout-plan.md` §5 band D asked for and it was blocked until `/store/facets` started
 * returning one image per team — the plan's §8 item 5. nflshop.com puts official club
 * crests here and we licence none of them (§7); a picture of goods we hold is not a mark,
 * it is what every reseller shows.
 *
 * **The colour disc is still here, as the fallback.** A team whose every product is
 * unphotographed gets its colours and initials rather than a grey box, and the ring around
 * every tile is the team's secondary colour either way — so a rail of photographs still
 * reads as a rail of teams rather than as a row of shirts. `DEFERRED.md` §6 is why the
 * fallback is not hypothetical: two products in three have exactly one photograph.
 *
 * The rail is context-dependent by design, which is what stops this becoming four
 * components: the homepage fills it with the biggest teams across every sport, a sport
 * listing fills it with that sport's teams, and the MMA range — which has no teams at all,
 * only fighters — fills it with athletes. `kind` only changes the fallback colour and the
 * label wording; the markup is identical.
 */
export type RailItem = {
  label: string
  href: string
  count?: number
  /** A photograph of that team's own stock. Falls back to the colour disc when absent. */
  image?: string | null
}

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
                    className={it.image ? 'raildisc photo' : 'raildisc'}
                    aria-hidden="true"
                    style={{
                      background: c.primary,
                      color: ink,
                      // The secondary is the ring, not the fill: two flat colours in one
                      // 78px circle read as a pie chart rather than as a club. It stays on
                      // the photo tiles too, which is what keeps the rail reading as teams.
                      boxShadow: `inset 0 0 0 3px ${c.secondary}`,
                    }}
                  >
                    {it.image
                      ? <img src={mediaUrl(it.image, 200) ?? undefined} alt=""
                             loading="lazy" decoding="async" />
                      : initials(it.label)}
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
