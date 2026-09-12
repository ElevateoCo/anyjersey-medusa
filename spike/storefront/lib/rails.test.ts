import { describe, it, expect } from 'vitest'
import { spread } from './rails'
import type { Card } from './medusa'

const p = (handle: string, team?: string | null, player?: string | null): Card => ({
  id: handle, handle, title: handle, thumbnail: null, price: 6599, sizes: 5,
  detail: { team: team ?? null, player: player ?? null },
})

describe('spread', () => {
  /**
   * The defect this exists for. The listing sorts alphabetically by handle, so the first
   * six football products were six Arizona Cardinals shirts — three of them the same shirt
   * in three colours — and every sport rail on the homepage opened with the same club.
   */
  it('takes one shirt per team', () => {
    const got = spread([
      p('a1', 'Arizona Cardinals'), p('a2', 'Arizona Cardinals'),
      p('a3', 'Arizona Cardinals'), p('b1', 'Buffalo Bills'),
      p('c1', 'Chicago Bears'), p('c2', 'Chicago Bears'), p('d1', 'Dallas Cowboys'),
    ], 3)
    expect(got.map((x) => x.handle)).toEqual(['a1', 'b1', 'c1'])
  })

  it('keeps the order the API returned, rather than re-sorting', () => {
    // "newest" has to still mean newest — this thins, it does not rank.
    const got = spread([p('z', 'Z'), p('a', 'A'), p('m', 'M')], 3)
    expect(got.map((x) => x.handle)).toEqual(['z', 'a', 'm'])
  })

  it('falls back to the player for a product with no team', () => {
    // The whole MMA range: a player, a sport, and no club at all. Keyed on team alone every
    // fighter shares the key `null` and the rail collapses to one shirt.
    const got = spread([
      p('m1', null, 'Islam Makhachev'), p('m2', null, 'Islam Makhachev'),
      p('m3', null, 'Conor Mcgregor'),
    ], 2)
    expect(got.map((x) => x.handle)).toEqual(['m1', 'm3'])
  })

  it('falls back to the handle when there is neither', () => {
    const got = spread([p('x1'), p('x2')], 6)
    expect(got).toHaveLength(2)
  })

  it('fills with duplicates rather than rendering a short rail', () => {
    // Hockey has sixteen products and nine clubs. A gap in the grid is worse than a club
    // appearing twice.
    const got = spread([
      p('a1', 'A'), p('a2', 'A'), p('a3', 'A'), p('b1', 'B'), p('b2', 'B'),
    ], 4)
    expect(got).toHaveLength(4)
    expect(new Set(got.map((x) => x.handle)).size).toBe(4)
  })

  it('never returns more than asked for, or the same product twice', () => {
    const got = spread([p('a', 'A'), p('b', 'B'), p('c', 'C')], 2)
    expect(got).toHaveLength(2)
    expect(new Set(got.map((x) => x.id)).size).toBe(2)
  })
})
