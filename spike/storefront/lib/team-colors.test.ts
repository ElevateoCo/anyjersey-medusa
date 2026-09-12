import { describe, it, expect } from 'vitest'
import { teamColour, hasTeamColour, readableInk } from './team-colors'

/** The same formula the checker and `readableInk` use, so the assertions are not circular
 *  on a shared helper — this one is written out longhand from the WCAG definition. */
function ratio(a: string, b: string) {
  const lum = (hex: string) => {
    const c = hex.replace('#', '')
    const ch = (i: number) => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('teamColour', () => {
  it('gives a named team its own colours', () => {
    expect(teamColour('Green Bay Packers')).toEqual({ primary: '#203731', secondary: '#FFB612' })
  })

  it('resolves the "Team " prefix, so the national sides are one entry not two', () => {
    // The catalogue carries both "Team Spain" and, for other countries, the bare name.
    expect(teamColour('Team Spain')).toEqual(teamColour('Spain'))
    expect(teamColour('Team Portugal')).toEqual(teamColour('Portugal'))
  })

  it('folds the apostrophe the catalogue actually uses', () => {
    expect(teamColour('Sean O’ Malley')).toEqual(teamColour("Sean O' Malley"))
  })

  /**
   * A moved or renamed team keeps the colours it wore under that name. This shop sells
   * retro shirts, so a 1995 Oilers shirt filed under Titans navy would be wrong on the
   * only visual the tile has.
   */
  it('keeps historical names on their historical colours', () => {
    expect(teamColour('Houston Oilers')).not.toEqual(teamColour('Tennessee Titans'))
    expect(teamColour('Washington Redskins')).not.toEqual(teamColour('Washington Commanders'))
    // A relocation that kept its identity keeps its colours.
    expect(teamColour('Oakland Raiders')).toEqual(teamColour('Las Vegas Raiders'))
  })

  it('is deterministic for a team it does not name', () => {
    expect(hasTeamColour('Some Unmapped FC')).toBe(false)
    // Same input, same colour, on the server and after hydration — a random fallback would
    // paint one colour into the HTML and a different one on the client.
    expect(teamColour('Some Unmapped FC')).toEqual(teamColour('Some Unmapped FC'))
  })

  it('always returns a pair, never undefined', () => {
    for (const name of ['', 'x', 'Team', 'Nürnberg', '不明']) {
      const c = teamColour(name)
      expect(c.primary).toMatch(/^#[0-9A-F]{6}$/i)
      expect(c.secondary).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })
})

describe('readableInk', () => {
  it('picks white on a dark ground and ink on a light one', () => {
    expect(readableInk('#101820')).toBe('#FFFFFF')   // Steelers black
    expect(readableInk('#FFB612')).toBe('#121212')   // Packers gold
  })

  /**
   * The claim the rail rests on. The disc initials are 1.55rem in a 600-weight condensed
   * face — large text under 1.4.3, which needs 3:1 — and several of these grounds fail
   * that against one of the two inks and pass against the other. `contrast_check.py` has
   * no way to evaluate a colour generated at render time, so this is where it is checked.
   */
  it('clears 3:1 large-text contrast on every colour in the map', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync(new URL('./team-colors.ts', import.meta.url), 'utf8'))
    const primaries = [...src.matchAll(/primary: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1])
    expect(primaries.length).toBeGreaterThan(150)

    const failures = primaries.filter((p) => ratio(readableInk(p), p) < 3)
    expect(failures).toEqual([])
  })

  it('always picks the better of the two, not merely a passing one', () => {
    for (const bg of ['#7BAFD4', '#CFB87C', '#5D76A9', '#F7B5CD', '#EEE1C6']) {
      const chosen = readableInk(bg)
      const other = chosen === '#FFFFFF' ? '#121212' : '#FFFFFF'
      expect(ratio(chosen, bg)).toBeGreaterThanOrEqual(ratio(other, bg))
    }
  })
})
