/**
 * Team colours.
 *
 * `layout-plan.md` band D calls for a rail of circular tiles, one per team, the way
 * nflshop.com does it. Theirs carry official club crests. **We licence no crests and will
 * not draw lookalikes** (§7 — Fanatics is an NFL licensee, we are a reseller, and putting
 * the marks in site chrome is trademark use where naming the team in text is not), and the
 * photo-crop alternative the plan proposes needs a per-team thumbnail endpoint that does
 * not exist yet.
 *
 * So the tile is the team's colours with its initials on top. A colour pair is not a mark:
 * it is not registrable on its own, every broadcaster and newspaper uses club colours to
 * denote a club, and a shopper reading a rail of discs recognises navy-and-gold as the
 * Rams the way they recognise it on a scoreboard. It gives the rail the same instant
 * scan as the reference without claiming an association we do not have.
 *
 * Values are the widely published primary/secondary pairs. Where a team has moved or been
 * renamed, the historical name keeps the colours it wore under that name — this catalogue
 * sells retro shirts, and a 1995 Oilers shirt under Titans navy would be wrong.
 *
 * A team with no entry falls through to `hashed()`, which is deterministic rather than
 * random: the same team gets the same colour on every render, on every machine, so the
 * rail does not reshuffle between the server and the client.
 */
export type TeamColour = { primary: string; secondary: string }

const COLOURS: Record<string, TeamColour> = {
  // ---- NFL ----
  'arizona cardinals': { primary: '#97233F', secondary: '#FFB612' },
  'atlanta falcons': { primary: '#A71930', secondary: '#A5ACAF' },
  'baltimore ravens': { primary: '#241773', secondary: '#9E7C0C' },
  'buffalo bills': { primary: '#00338D', secondary: '#C60C30' },
  'carolina panthers': { primary: '#0085CA', secondary: '#101820' },
  'chicago bears': { primary: '#0B162A', secondary: '#C83803' },
  'cincinnati bengals': { primary: '#FB4F14', secondary: '#101820' },
  'cleveland browns': { primary: '#311D00', secondary: '#FF3C00' },
  'dallas cowboys': { primary: '#003594', secondary: '#869397' },
  'denver broncos': { primary: '#FB4F14', secondary: '#002244' },
  'detroit lions': { primary: '#0076B6', secondary: '#B0B7BC' },
  'green bay packers': { primary: '#203731', secondary: '#FFB612' },
  'houston texans': { primary: '#03202F', secondary: '#A71930' },
  'houston oilers': { primary: '#C8102E', secondary: '#4B92DB' },
  'indianapolis colts': { primary: '#002C5F', secondary: '#A2AAAD' },
  'jacksonville jaguars': { primary: '#006778', secondary: '#D7A22A' },
  'kansas city chiefs': { primary: '#E31837', secondary: '#FFB81C' },
  'las vegas raiders': { primary: '#101820', secondary: '#A5ACAF' },
  'oakland raiders': { primary: '#101820', secondary: '#A5ACAF' },
  'los angeles chargers': { primary: '#0080C6', secondary: '#FFC20E' },
  'san diego chargers': { primary: '#0080C6', secondary: '#FFC20E' },
  'los angeles rams': { primary: '#003594', secondary: '#FFA300' },
  'st. louis rams': { primary: '#003594', secondary: '#FFA300' },
  'st louis rams': { primary: '#003594', secondary: '#FFA300' },
  'miami dolphins': { primary: '#008E97', secondary: '#FC4C02' },
  'minnesota vikings': { primary: '#4F2683', secondary: '#FFC62F' },
  'new england patriots': { primary: '#002244', secondary: '#C60C30' },
  'new orleans saints': { primary: '#101820', secondary: '#D3BC8D' },
  'new york giants': { primary: '#0B2265', secondary: '#A71930' },
  'new york jets': { primary: '#125740', secondary: '#FFFFFF' },
  'philadelphia eagles': { primary: '#004C54', secondary: '#A5ACAF' },
  'pittsburgh steelers': { primary: '#101820', secondary: '#FFB612' },
  'san francisco 49ers': { primary: '#AA0000', secondary: '#B3995D' },
  'seattle seahawks': { primary: '#002244', secondary: '#69BE28' },
  'tampa bay buccaneers': { primary: '#D50A0A', secondary: '#34302B' },
  'tennessee titans': { primary: '#0C2340', secondary: '#4B92DB' },
  'washington commanders': { primary: '#5A1414', secondary: '#FFB612' },
  'washington redskins': { primary: '#773141', secondary: '#FFB612' },

  // ---- NBA ----
  'atlanta hawks': { primary: '#E03A3E', secondary: '#C1D32F' },
  'boston celtics': { primary: '#007A33', secondary: '#BA9653' },
  'brooklyn nets': { primary: '#101820', secondary: '#FFFFFF' },
  'new jersey nets': { primary: '#002A60', secondary: '#CD1041' },
  'charlotte hornets': { primary: '#1D1160', secondary: '#00788C' },
  'chicago bulls': { primary: '#CE1141', secondary: '#101820' },
  'cleveland cavaliers': { primary: '#860038', secondary: '#FDBB30' },
  'dallas mavericks': { primary: '#00538C', secondary: '#B8C4CA' },
  'denver nuggets': { primary: '#0E2240', secondary: '#FEC524' },
  'detroit pistons': { primary: '#C8102E', secondary: '#1D42BA' },
  'golden state warriors': { primary: '#1D428A', secondary: '#FFC72C' },
  'houston rockets': { primary: '#CE1141', secondary: '#C4CED4' },
  'indiana pacers': { primary: '#002D62', secondary: '#FDBB30' },
  'los angeles clippers': { primary: '#C8102E', secondary: '#1D428A' },
  'los angeles lakers': { primary: '#552583', secondary: '#FDB927' },
  'memphis grizzlies': { primary: '#5D76A9', secondary: '#12173F' },
  'miami heat': { primary: '#98002E', secondary: '#F9A01B' },
  'milwaukee bucks': { primary: '#00471B', secondary: '#EEE1C6' },
  'minnesota timberwolves': { primary: '#0C2340', secondary: '#236192' },
  'new orleans pelicans': { primary: '#0C2340', secondary: '#C8102E' },
  'new york knicks': { primary: '#006BB6', secondary: '#F58426' },
  'oklahoma city thunder': { primary: '#007AC1', secondary: '#EF3B24' },
  'orlando magic': { primary: '#0077C0', secondary: '#C4CED4' },
  'philadelphia 76ers': { primary: '#006BB6', secondary: '#ED174C' },
  'phoenix suns': { primary: '#1D1160', secondary: '#E56020' },
  'portland trail blazers': { primary: '#E03A3E', secondary: '#101820' },
  'sacramento kings': { primary: '#5A2D81', secondary: '#63727A' },
  'san antonio spurs': { primary: '#101820', secondary: '#C4CED4' },
  'seattle supersonics': { primary: '#00653A', secondary: '#FFC200' },
  'toronto raptors': { primary: '#CE1141', secondary: '#101820' },
  'utah jazz': { primary: '#002B5C', secondary: '#F9A01B' },
  'washington wizards': { primary: '#002B5C', secondary: '#E31837' },

  // ---- MLB ----
  'atlanta braves': { primary: '#CE1141', secondary: '#13274F' },
  'baltimore orioles': { primary: '#DF4601', secondary: '#101820' },
  'boston red sox': { primary: '#BD3039', secondary: '#0C2340' },
  'chicago cubs': { primary: '#0E3386', secondary: '#CC3433' },
  'chicago white sox': { primary: '#27251F', secondary: '#C4CED4' },
  'cincinnati reds': { primary: '#C6011F', secondary: '#101820' },
  'cleveland guardians': { primary: '#00385D', secondary: '#E50022' },
  'cleveland indians': { primary: '#0C2340', secondary: '#E31937' },
  'detroit tigers': { primary: '#0C2340', secondary: '#FA4616' },
  'houston astros': { primary: '#002D62', secondary: '#EB6E1F' },
  'kansas city royals': { primary: '#004687', secondary: '#BD9B60' },
  'los angeles angels': { primary: '#BA0021', secondary: '#003263' },
  'los angeles dodgers': { primary: '#005A9C', secondary: '#EF3E42' },
  'miami marlins': { primary: '#00A3E0', secondary: '#EF3340' },
  'milwaukee brewers': { primary: '#12284B', secondary: '#FFC52F' },
  'new york mets': { primary: '#002D72', secondary: '#FF5910' },
  'new york yankees': { primary: '#0C2340', secondary: '#C4CED3' },
  'oakland athletics': { primary: '#003831', secondary: '#EFB21E' },
  'philadelphia phillies': { primary: '#E81828', secondary: '#002D72' },
  'pittsburgh pirates': { primary: '#27251F', secondary: '#FDB827' },
  'san diego padres': { primary: '#2F241D', secondary: '#FFC425' },
  'san francisco giants': { primary: '#FD5A1E', secondary: '#27251F' },
  'seattle mariners': { primary: '#0C2C56', secondary: '#005C5C' },
  'st louis cardinals': { primary: '#C41E3A', secondary: '#0C2340' },
  'st. louis cardinals': { primary: '#C41E3A', secondary: '#0C2340' },
  'tampa bay rays': { primary: '#092C5C', secondary: '#8FBCE6' },
  'texas rangers': { primary: '#003278', secondary: '#C0111F' },
  'toronto blue jays': { primary: '#134A8E', secondary: '#1D2D5C' },

  // ---- NHL ----
  'boston bruins': { primary: '#101820', secondary: '#FFB81C' },
  'chicago blackhawks': { primary: '#CF0A2C', secondary: '#101820' },
  'colorado avalanche': { primary: '#6F263D', secondary: '#236192' },
  'detroit red wings': { primary: '#CE1126', secondary: '#FFFFFF' },
  'florida panthers': { primary: '#041E42', secondary: '#C8102E' },
  'minnesota wild': { primary: '#154734', secondary: '#A6192E' },
  'nashville predators': { primary: '#041E42', secondary: '#FFB81C' },
  'san jose sharks': { primary: '#006D75', secondary: '#101820' },
  'washington capitals': { primary: '#041E42', secondary: '#C8102E' },

  // ---- NCAA ----
  'alabama crimson tide': { primary: '#9E1B32', secondary: '#828A8F' },
  'arizona state sun devils': { primary: '#8C1D40', secondary: '#FFC627' },
  'auburn tigers': { primary: '#0C2340', secondary: '#DD550C' },
  'colorado buffaloes': { primary: '#000000', secondary: '#CFB87C' },
  'florida gators': { primary: '#0021A5', secondary: '#FA4616' },
  'georgia bulldogs': { primary: '#BA0C2F', secondary: '#101820' },
  'georgia tech yellow jackets': { primary: '#003057', secondary: '#B3A369' },
  'indiana hoosiers': { primary: '#990000', secondary: '#EEEDEB' },
  'iowa hawkeyes': { primary: '#101820', secondary: '#FFCD00' },
  'lsu tigers': { primary: '#461D7C', secondary: '#FDD023' },
  'miami hurricanes': { primary: '#005030', secondary: '#F47321' },
  'michigan wolverines': { primary: '#00274C', secondary: '#FFCB05' },
  'missouri tigers': { primary: '#101820', secondary: '#F1B82D' },
  'north carolina tar heels': { primary: '#7BAFD4', secondary: '#13294B' },
  'notre dame fighting irish': { primary: '#0C2340', secondary: '#C99700' },
  'ohio state buckeyes': { primary: '#BB0000', secondary: '#666666' },
  'oklahoma sooners': { primary: '#841617', secondary: '#FDF9D8' },
  'ole miss rebels': { primary: '#14213D', secondary: '#CE1126' },
  'oregon ducks': { primary: '#154733', secondary: '#FEE123' },
  'penn state nittany lions': { primary: '#041E42', secondary: '#FFFFFF' },
  'texas a&m aggies': { primary: '#500000', secondary: '#FFFFFF' },
  'texas longhorns': { primary: '#BF5700', secondary: '#FFFFFF' },
  'texas tech red raiders': { primary: '#CC0000', secondary: '#101820' },
  'usc trojans': { primary: '#990000', secondary: '#FFC72C' },

  // ---- Clubs ----
  'ac milan': { primary: '#FB090B', secondary: '#101820' },
  arsenal: { primary: '#EF0107', secondary: '#063672' },
  barcelona: { primary: '#A50044', secondary: '#004D98' },
  'inter miami': { primary: '#F7B5CD', secondary: '#231F20' },
  juventus: { primary: '#101820', secondary: '#FFFFFF' },
  'manchester united': { primary: '#DA020E', secondary: '#FBE122' },
  'real madrid': { primary: '#00529F', secondary: '#FEBE10' },

  // ---- National sides ----
  // `normalise()` strips the "Team " prefix, so "Team Spain" and "Spain" are one key.
  argentina: { primary: '#75AADB', secondary: '#FFFFFF' },
  australia: { primary: '#00843D', secondary: '#FFCD00' },
  belgium: { primary: '#101820', secondary: '#FDDA24' },
  brazil: { primary: '#009C3B', secondary: '#FEDF00' },
  'cape verde': { primary: '#003893', secondary: '#CF2027' },
  colombia: { primary: '#003893', secondary: '#FCD116' },
  egypt: { primary: '#C8102E', secondary: '#101820' },
  england: { primary: '#CE1124', secondary: '#FFFFFF' },
  france: { primary: '#0055A4', secondary: '#EF4135' },
  germany: { primary: '#101820', secondary: '#DD0000' },
  'ivory coast': { primary: '#F77F00', secondary: '#009E60' },
  italy: { primary: '#0066A1', secondary: '#FFFFFF' },
  japan: { primary: '#BC002D', secondary: '#FFFFFF' },
  jordan: { primary: '#007A3D', secondary: '#CE1126' },
  mexico: { primary: '#006341', secondary: '#CE1126' },
  morocco: { primary: '#C1272D', secondary: '#006233' },
  netherlands: { primary: '#FF6C00', secondary: '#21468B' },
  norway: { primary: '#BA0C2F', secondary: '#00205B' },
  paraguay: { primary: '#D52B1E', secondary: '#0038A8' },
  peru: { primary: '#D91023', secondary: '#FFFFFF' },
  portugal: { primary: '#046A38', secondary: '#DA291C' },
  'saudi arabia': { primary: '#006C35', secondary: '#FFFFFF' },
  scotland: { primary: '#005EB8', secondary: '#FFFFFF' },
  'south africa': { primary: '#007A4D', secondary: '#FFB612' },
  'south korea': { primary: '#003478', secondary: '#C60C30' },
  spain: { primary: '#AA151B', secondary: '#F1BF00' },
  sweden: { primary: '#006AA7', secondary: '#FECC00' },
  switzerland: { primary: '#DA291C', secondary: '#FFFFFF' },
  turkiye: { primary: '#E30A17', secondary: '#FFFFFF' },
  usa: { primary: '#3C3B6E', secondary: '#B22234' },
  venezuela: { primary: '#00247D', secondary: '#FFCD00' },
}

/**
 * Fallbacks, for a team the map does not name — and for an athlete, who has no colours at
 * all. Chosen to sit beside the brand ink without competing with the one yellow.
 */
const FALLBACK: TeamColour[] = [
  { primary: '#2A3D66', secondary: '#8FA6C9' },
  { primary: '#1F4D3D', secondary: '#8CC2A8' },
  { primary: '#6B2137', secondary: '#D19AA9' },
  { primary: '#4A3B6B', secondary: '#AFA0CE' },
  { primary: '#2D4F55', secondary: '#93BDC2' },
  { primary: '#5C3A1E', secondary: '#C7A183' },
]

/** Lower-case, fold the punctuation, and drop the "Team " that half the national sides carry. */
function normalise(team: string): string {
  return team
    .toLowerCase()
    .replace(/^team\s+/, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Same input, same colour, on the server and in the browser. */
function hashed(key: string): TeamColour {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}

export function teamColour(team: string): TeamColour {
  return COLOURS[normalise(team)] ?? hashed(normalise(team))
}

/** True when the map names this team, rather than the hash having picked for it. */
export const hasTeamColour = (team: string) => normalise(team) in COLOURS

/**
 * Black or white over that background, whichever the eye can actually read.
 *
 * WCAG 1.4.3 at its large-text threshold — the initials are 1.5rem in a bold condensed
 * face, comfortably over 18.66px bold — needs 3:1, and several of these backgrounds
 * (Packers gold, Cape Verde blue) fail that against one of the two and pass against the
 * other. Computing it beats hand-maintaining a third column that has to be re-checked
 * every time a colour is corrected, and `contrast_check.py` has no way to evaluate a colour
 * this file generates at render time.
 */
export function readableInk(hex: string): '#FFFFFF' | '#121212' {
  const c = hex.replace('#', '')
  const ch = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4)
  // Contrast against white is (1.05)/(L+0.05); against our ink (#121212, L≈0.00605) it is
  // (L+0.05)/0.05605. Pick the larger.
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05605 ? '#FFFFFF' : '#121212'
}
