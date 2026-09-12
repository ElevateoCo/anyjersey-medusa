/**
 * Classify the products the title parser could not.
 *
 *   npx medusa exec ./src/scripts/fix-taxonomy-gaps.ts         # report only
 *   npx medusa exec ./src/scripts/fix-taxonomy-gaps.ts write   # apply
 *
 * `layout-plan.md` §8 item 1. 73 published products carry no `sport`, which makes them
 * unreachable from the category bar, from every sport rail and from the facet sidebar —
 * the store holds them and no navigation leads anywhere near them. The same rows are why
 * the Shop by Athlete panel has to drop its unsported bucket: when the parser fails to find
 * a team it leaves the whole phrase in `player`, so "Detriot Lions" and "Philidelphia
 * 76ers" are sitting in the column the athlete navigation reads.
 *
 * ---
 *
 * **The rule this table follows: the title names the team, and the job is to spell it
 * correctly — not to look up a roster.**
 *
 * "Las Vegas Ashton Jeanty Black Jersey" is a Raiders shirt because the title says Las
 * Vegas, not because of what anybody knows about the 2025 draft. That keeps the corrections
 * checkable by reading them against the titles, and it is the honest reading of what the
 * merchant listed. Where a title names **no** team — "Tom Brady Super Bowl 51 Jersey" —
 * `team` stays null and only `sport`, `league` and `player` are filled in. A wrong team is
 * worse than a missing one, and that principle is already why 34 city-named basketball
 * shirts fell through to `needs_review` during the Step 26 re-sync rather than being
 * guessed at.
 *
 * Two entries were not derivable from the title and were checked:
 *
 * - **Utah Mammoth** is a real NHL team, not a typo. The Arizona Coyotes' assets moved to
 *   Salt Lake City, played 2024–25 as Utah Hockey Club, and the permanent name was revealed
 *   on 7 May 2025. Clayton Keller is the captain.
 * - **Bryan Adrian** played *basketball* for Davidson in the early 1970s, which is what
 *   makes "Davidson Wildcats Bryan Adrian Red Vintage Jersey" a basketball shirt rather
 *   than a football one. Davidson fields both.
 */
import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { CATALOG_MODULE } from '../modules/catalog'

type Fix = {
  /** A distinctive fragment of the product title, matched case-insensitively. */
  match: string
  team: string | null
  league: string | null
  sport: string
  /** Null leaves whatever the parser found; a string replaces it. */
  player?: string | null
}

/**
 * Ordered: the first match wins, so a more specific title sits above a less specific one
 * that would also match it. "Philidelphia 76ers Wilt Chamberlain" must be tried before
 * "Philidelphia 76ers".
 */
const FIXES: Fix[] = [
  // ---- misspelled team names -------------------------------------------------
  { match: 'Philidelphia 76ers Wilt Chamberlain', team: 'Philadelphia 76ers',
    league: 'NBA', sport: 'basketball', player: 'Wilt Chamberlain' },
  { match: 'Philidelphia 76ers', team: 'Philadelphia 76ers',
    league: 'NBA', sport: 'basketball', player: null },
  { match: 'Sacremento Kings Chris Webber', team: 'Sacramento Kings',
    league: 'NBA', sport: 'basketball', player: 'Chris Webber' },
  { match: 'Sacremento Kings', team: 'Sacramento Kings',
    league: 'NBA', sport: 'basketball', player: null },
  { match: 'Memphis Grizzles', team: 'Memphis Grizzlies',
    league: 'NBA', sport: 'basketball', player: null },
  { match: 'Memphis Grizziles', team: 'Memphis Grizzlies',
    league: 'NBA', sport: 'basketball', player: null },
  { match: 'Golden State Warrios Stephen Curry', team: 'Golden State Warriors',
    league: 'NBA', sport: 'basketball', player: 'Stephen Curry' },
  { match: 'Detriot Lions', team: 'Detroit Lions',
    league: 'NFL', sport: 'football', player: null },
  { match: 'Tennesee Titans Cam Ward', team: 'Tennessee Titans',
    league: 'NFL', sport: 'football', player: 'Cam Ward' },
  { match: 'Tennesee Titans Carnell Tate', team: 'Tennessee Titans',
    league: 'NFL', sport: 'football', player: 'Carnell Tate' },
  { match: 'Flordia Panthers Matthew Tkachuk', team: 'Florida Panthers',
    league: 'NHL', sport: 'hockey', player: 'Matthew Tkachuk' },
  { match: 'Colombus Blue Jackets Zachary Werenski', team: 'Columbus Blue Jackets',
    league: 'NHL', sport: 'hockey', player: 'Zachary Werenski' },
  { match: 'Custom West Virgina', team: 'West Virginia Mountaineers',
    league: 'NCAA', sport: 'college football', player: null },

  // ---- a city or short form where the full team name was meant ----------------
  { match: 'La Kings Byfield', team: 'Los Angeles Kings', league: 'NHL', sport: 'hockey',
    player: 'Quinton Byfield' },
  { match: 'La Kings Doughty', team: 'Los Angeles Kings', league: 'NHL', sport: 'hockey',
    player: 'Drew Doughty' },
  { match: 'La Kings Kempe', team: 'Los Angeles Kings', league: 'NHL', sport: 'hockey',
    player: 'Adrian Kempe' },
  { match: 'La Kings Kopitar', team: 'Los Angeles Kings', league: 'NHL', sport: 'hockey',
    player: 'Anze Kopitar' },
  { match: 'La Kings Quick', team: 'Los Angeles Kings', league: 'NHL', sport: 'hockey',
    player: 'Jonathan Quick' },
  // Las Vegas fields three franchises; every one of these titles is a "Jersey" carrying a
  // footballer's name, so the Raiders are the only reading that fits.
  { match: 'Las Vegas Ashton Jeanty', team: 'Las Vegas Raiders', league: 'NFL',
    sport: 'football', player: 'Ashton Jeanty' },
  { match: 'Las Vegas Bo Jackson', team: 'Las Vegas Raiders', league: 'NFL',
    sport: 'football', player: 'Bo Jackson' },
  { match: 'Las Vegas Brock Bowers', team: 'Las Vegas Raiders', league: 'NFL',
    sport: 'football', player: 'Brock Bowers' },
  { match: 'Las Vegas Charles Woodson', team: 'Las Vegas Raiders', league: 'NFL',
    sport: 'football', player: 'Charles Woodson' },
  { match: 'Las Vegas Maxx Crosby', team: 'Las Vegas Raiders', league: 'NFL',
    sport: 'football', player: 'Maxx Crosby' },
  { match: 'San Antonio Dylan Harper', team: 'San Antonio Spurs', league: 'NBA',
    sport: 'basketball', player: 'Dylan Harper' },
  { match: 'Toronto Blue George Springer', team: 'Toronto Blue Jays', league: 'MLB',
    sport: 'baseball', player: 'George Springer' },
  { match: 'Toronto Blue Trey Yesavage', team: 'Toronto Blue Jays', league: 'MLB',
    sport: 'baseball', player: 'Trey Yesavage' },
  { match: 'Tampa Bay Bucky Irving', team: 'Tampa Bay Buccaneers', league: 'NFL',
    sport: 'football', player: 'Bucky Irving' },
  { match: 'Utah Mammoth Clayton Keller', team: 'Utah Mammoth', league: 'NHL',
    sport: 'hockey', player: 'Clayton Keller' },

  // ---- college ---------------------------------------------------------------
  { match: 'Davidson Wildcats Bryan Adrian', team: 'Davidson Wildcats', league: 'NCAA',
    sport: 'basketball', player: 'Bryan Adrian' },
  { match: 'Georgetown Hoyas Allen Iverson', team: 'Georgetown Hoyas', league: 'NCAA',
    sport: 'basketball', player: 'Allen Iverson' },
  { match: 'South Carolina Dylan Stewart', team: 'South Carolina Gamecocks', league: 'NCAA',
    sport: 'college football', player: 'Dylan Stewart' },
  { match: 'Vanderbilt Commodores Diego Pavia', team: 'Vanderbilt Commodores',
    league: 'NCAA', sport: 'college football', player: 'Diego Pavia' },
  { match: 'Wyoming Cowboys Josh Allen', team: 'Wyoming Cowboys', league: 'NCAA',
    sport: 'college football', player: 'Josh Allen' },
  { match: 'Fsu Derrick Brooks', team: 'Florida State Seminoles', league: 'NCAA',
    sport: 'college football', player: 'Derrick Brooks' },
  { match: 'Pat Tillman Asu Rosebowl', team: 'Arizona State Sun Devils', league: 'NCAA',
    sport: 'college football', player: 'Pat Tillman' },
  // A high school, not a college. It is still where the shirt is from, and leaving it
  // unsported would keep the most recognisable name on this list out of the navigation.
  { match: 'Lower Merion Kobe Bryant', team: 'Lower Merion', league: null,
    sport: 'basketball', player: 'Kobe Bryant' },

  // ---- national sides --------------------------------------------------------
  { match: 'Dominican Republic Fernando Tatis', team: 'Dominican Republic', league: 'MLB',
    sport: 'baseball', player: 'Fernando Tatis Jr.' },
  { match: 'Dominican Republic Juan Soto', team: 'Dominican Republic', league: 'MLB',
    sport: 'baseball', player: 'Juan Soto' },
  { match: 'World Cup James Rodriguez', team: 'Team Colombia', league: 'SOCCER',
    sport: 'soccer', player: 'James Rodriguez' },
  { match: '2026 World Cup USA Windbreaker', team: 'Team USA', league: 'SOCCER',
    sport: 'soccer', player: null },
  // The NBA All-Star sides are not franchises, so there is no league to give them.
  { match: 'Eastern Confrence', team: 'Eastern Conference', league: null,
    sport: 'basketball', player: null },

  // ---- MMA combos the collection did not cover -------------------------------
  { match: 'Alexander Volkanovski', team: null, league: null, sport: 'mma',
    player: 'Alexander Volkanovski' },
  { match: 'Charles Oliveira', team: null, league: null, sport: 'mma',
    player: 'Charles Oliveira' },

  // ---- the title names a player and no team ----------------------------------
  // `team` deliberately stays null. Super Bowl 51 was the Patriots and Zach Thomas was a
  // Dolphin, but the listing does not say so and inventing it is the failure mode the
  // whole file is written against.
  { match: 'Cristiano Ronaldo', team: null, league: 'SOCCER', sport: 'soccer',
    player: 'Cristiano Ronaldo' },
  { match: 'Jaxon Smith Njigba', team: null, league: 'NFL', sport: 'football',
    player: 'Jaxon Smith-Njigba' },
  { match: 'Tom Brady Super Bowl', team: null, league: 'NFL', sport: 'football',
    player: 'Tom Brady' },
  { match: 'Zach Thomas', team: null, league: 'NFL', sport: 'football',
    player: 'Zach Thomas' },
  { match: 'Russell Westbrook', team: null, league: 'NBA', sport: 'basketball',
    player: 'Russell Westbrook' },
]

export default async function fixTaxonomyGaps({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const catalog: any = container.resolve(CATALOG_MODULE)
  const write = args?.includes('write')

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'title', 'status',
      'jersey_detail.id', 'jersey_detail.sport', 'jersey_detail.league',
      'jersey_detail.team', 'jersey_detail.player'],
    pagination: { take: 100000, skip: 0 } as any,
  })

  const unsported = (products as any[]).filter(
    (p) => p.jersey_detail?.id && !p.jersey_detail.sport
  )

  const updates: any[] = []
  const unmatched: { title: string; detailId: string }[] = []

  for (const p of unsported) {
    const title = String(p.title)
    const fix = FIXES.find((f) => title.toLowerCase().includes(f.match.toLowerCase()))
    if (!fix) { unmatched.push({ title, detailId: p.jersey_detail.id }); continue }

    const d = p.jersey_detail
    const next: any = { id: d.id, sport: fix.sport }
    if (fix.team !== null) next.team = fix.team
    if (fix.league !== null) next.league = fix.league
    // `player: null` in the table means "clear whatever the parser left here", which for
    // these rows is a misspelled team name rather than a person.
    if (fix.player !== undefined) next.player = fix.player

    updates.push(next)
    logger.info(
      `${title}\n    sport ${d.sport ?? '(none)'} -> ${fix.sport}` +
      (fix.team !== null ? `\n    team  ${d.team ?? '(none)'} -> ${fix.team}` : '') +
      (fix.player !== undefined && fix.player !== d.player
        ? `\n    player "${d.player ?? ''}" -> ${fix.player === null ? '(cleared)' : `"${fix.player}"`}`
        : '')
    )
  }

  /**
   * Anything no rule matched is flagged rather than guessed at or removed.
   *
   * The one row this catches today is "Rolex Watches", which is published, handled
   * `rolex-watches-jersey`, and is not a jersey. Whether it should be in a jersey
   * catalogue is a merchandising decision and not one to take from a script — so it goes
   * into the admin's **Needs review** queue, where somebody who owns the catalogue will
   * see it, and stays on sale until they do.
   */
  const flags = unmatched.map((u) => ({ id: u.detailId, needs_review: true }))

  logger.info(`\n${unsported.length} unsported, ${updates.length} classified.`)
  if (unmatched.length) {
    logger.warn(
      `${unmatched.length} left unclassified — no rule matched, and guessing is the thing ` +
      `this script exists not to do. Flagged for review:\n  ` +
      unmatched.map((u) => u.title).join('\n  ')
    )
  }
  if (!updates.length && !flags.length) return
  if (!write) {
    logger.info(`Re-run with \`write\` to apply.`)
    return
  }
  if (updates.length) await catalog.updateJerseyDetails(updates)
  if (flags.length) await catalog.updateJerseyDetails(flags)
  logger.info(
    `Updated ${updates.length} jersey_detail rows` +
    (flags.length ? `, flagged ${flags.length} for review.` : '.')
  )
}
