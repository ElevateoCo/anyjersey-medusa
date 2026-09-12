import { describe, it, expect } from 'vitest'
import { buildNav } from './nav'
import type { Facets, CuratedCollection } from './medusa'

/** Shaped like the live `/store/facets`, with the counts that make each rule fire. */
const facets = (over: Partial<Facets> = {}): Facets => ({
  total: 4323,
  custom: 69,
  leagues: [
    { value: 'NFL', count: 2407 }, { value: 'SOCCER', count: 504 },
    { value: 'NBA', count: 477 }, { value: 'MLB', count: 476 },
    { value: 'NCAA', count: 320 }, { value: 'CLUB', count: 37 },
    { value: 'NHL', count: 16 },
  ],
  teams: [
    { value: 'Dallas Cowboys', count: 146, league: 'NFL', sport: 'football', image: null },
    { value: 'Los Angeles Dodgers', count: 98, league: 'MLB', sport: 'baseball', image: null },
    { value: 'Team Argentina', count: 62, league: 'SOCCER', sport: 'soccer', image: null },
    { value: 'Barcelona', count: 15, league: 'CLUB', sport: 'soccer', image: null },
    { value: 'Florida Panthers', count: 4, league: 'NHL', sport: 'hockey', image: null },
  ],
  sports: [
    { value: 'football', count: 2406 }, { value: 'soccer', count: 542 },
    { value: 'basketball', count: 477 }, { value: 'baseball', count: 476 },
    { value: 'college football', count: 320 },
    { value: 'hockey', count: 16 }, { value: 'mma', count: 13 },
  ],
  colourways: [{ value: 'white', count: 1217 }],
  garments: [
    { value: 'jersey', count: 4122 }, { value: 'shorts', count: 177 },
    { value: 'longsleeve-jersey', count: 9 }, { value: 'set', count: 9 },
    { value: 'jacket', count: 5 }, { value: 'hat', count: 1 },
  ],
  seasons: [],
  players: [
    { sport: 'football', players: [{ value: 'Tom Brady', count: 10, team: 'New England Patriots' }] },
    { sport: 'mma', players: [{ value: 'Islam Makhachev', count: 2, team: null }] },
    // The wreckage §8 item 1 describes: misspelled teams sitting in the player column.
    { sport: null, players: [{ value: 'Detriot Lions', count: 2, team: null }] },
  ],
  ...over,
})

const collections: CuratedCollection[] = [
  { handle: 'best-sellers', title: 'Best Sellers', description: null, count: 415 },
  { handle: 'world-cup-2026', title: 'World Cup 2026', description: null, count: 513 },
]

const labels = (slots: { label: string }[]) => slots.map((s) => s.label)

describe('buildNav', () => {
  it('spends twelve slots plus an overflow, the reference\'s own budget', () => {
    const { bar } = buildNav(facets(), collections)
    expect(labels(bar)).toEqual([
      'Shop All', 'Shop by Team', 'Shop by Athlete', 'Best Sellers',
      'Football', 'Soccer', 'Basketball', 'Baseball', 'College',
      'Jerseys', 'Shorts & Kits', 'Custom',
      'More',
    ])
    // Twelve, then More. More is the overflow control, not a thirteenth category.
    expect(bar.filter((s) => s.key !== 'more')).toHaveLength(12)
  })

  it('keeps counts off the bar and puts them in the panels', () => {
    const { bar } = buildNav(facets(), collections)
    for (const slot of bar) expect(slot.label).not.toMatch(/\d/)
    const teams = bar.find((s) => s.key === 'teams')!
    expect(teams.panel!.columns[0].links[0].count).toBe(146)
  })

  it('drops a sport below the threshold off the bar and into More', () => {
    const { bar } = buildNav(facets(), collections)
    expect(labels(bar)).not.toContain('Hockey')
    expect(labels(bar)).not.toContain('MMA')
    const more = bar.find((s) => s.key === 'more')!
    const sports = more.panel!.columns.find((c) => c.title === 'More sports')!
    expect(sports.links.map((l) => l.label)).toEqual(['Hockey', 'MMA'])
  })

  it('groups the team panel by league, biggest league first', () => {
    const { bar } = buildNav(facets(), collections)
    const teams = bar.find((s) => s.key === 'teams')!
    expect(teams.panel!.columns.map((c) => c.title))
      .toEqual(['NFL', 'MLB', 'International', 'Clubs', 'NHL'])
  })

  /**
   * The single most important assertion in this file. The unsported player bucket is not a
   * sport we have yet to name — it is misspelled team names sitting in the `player`
   * column. Rendering it would put "Detriot Lions" into the navigation under "Athletes".
   */
  it('never renders the unsported player bucket as athletes', () => {
    const { bar } = buildNav(facets(), collections)
    const athletes = bar.find((s) => s.key === 'athletes')!
    const every = athletes.panel!.columns.flatMap((c) => c.links.map((l) => l.label))
    expect(every).toContain('Islam Makhachev')
    expect(every).not.toContain('Detriot Lions')
  })

  it('keeps the MMA range reachable even though MMA is off the bar', () => {
    const { bar } = buildNav(facets(), collections)
    const athletes = bar.find((s) => s.key === 'athletes')!
    expect(athletes.panel!.columns.map((c) => c.title)).toContain('MMA')
  })

  it('repeats the garment key rather than comma-joining it', () => {
    const { bar } = buildNav(facets(), collections)
    // A comma would reach MikroORM as the literal string "shorts,set" and match nothing —
    // an empty listing that looks exactly like an empty catalogue.
    expect(bar.find((s) => s.key === 'shorts')!.href)
      .toBe('/jerseys?garment=shorts&garment=set')
    expect(bar.find((s) => s.key === 'jerseys')!.href).not.toContain(',')
  })

  it('guards Best Sellers on the collection existing', () => {
    const { bar } = buildNav(facets(), [])
    expect(labels(bar)).not.toContain('Best Sellers')
    // The slot it frees is taken by the next thing in position order, not left empty.
    expect(bar.filter((s) => s.key !== 'more').length).toBeLessThanOrEqual(12)
  })

  it('drops the Custom slot when there are no custom jerseys', () => {
    const { bar } = buildNav(facets({ custom: 0 }), collections)
    expect(labels(bar)).not.toContain('Custom')
  })

  it('is ordered by position, so a seasonal slot can be inserted by number', () => {
    const { bar } = buildNav(facets(), collections)
    const positions = bar.map((s) => s.position)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('puts the garment tail in Everything else rather than on the bar', () => {
    const { bar } = buildNav(facets(), collections)
    const more = bar.find((s) => s.key === 'more')!
    const tail = more.panel!.columns.find((c) => c.title === 'Everything else')!
    expect(tail.links.map((l) => l.label)).toEqual(expect.arrayContaining(['Jacket', 'Hat']))
  })

  it('survives a catalogue with no players facet at all', () => {
    const { bar } = buildNav(facets({ players: [] }), collections)
    expect(labels(bar)).not.toContain('Shop by Athlete')
    expect(labels(bar)).toContain('Shop All')
  })
})
