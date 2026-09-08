/**
 * Team → league, derived from the taxonomy already in the catalog.
 *
 * Generated from `select distinct league, team from jersey_detail` rather than typed out,
 * so it cannot disagree with the 3,155 products already classified. A second, hand-written
 * team list is how "Washington Commanders" and "Washington Redskins" end up in different
 * leagues in different files.
 *
 * Keys are upper-cased for matching; values are the league codes the facets already use.
 * Historic franchises are present on purpose — the catalog sells Houston Oilers and San
 * Diego Chargers shirts, and dropping them would send those to `needs_review`.
 *
 * Regenerate after a taxonomy change:
 *   docker exec aj-postgres psql -U aj -d aj_store -t -A -F'|' \
 *     -c "select league, team from jersey_detail where team is not null and league is not null"
 */
export const TEAM_LEAGUE: Record<string, string> = {
  // CLUB
  "AC MILAN": "CLUB",
  "ARSENAL": "CLUB",
  "BARCELONA": "CLUB",
  "INTER MIAMI": "CLUB",
  "JUVENTUS": "CLUB",
  "MANCHESTER UNITED": "CLUB",
  "REAL MADRID": "CLUB",

  // MLB
  "ATLANTA BRAVES": "MLB",
  "BALTIMORE ORIOLES": "MLB",
  "BOSTON RED SOX": "MLB",
  "CHICAGO CUBS": "MLB",
  "CHICAGO WHITE SOX": "MLB",
  "CINCINNATI REDS": "MLB",
  "CLEVELAND GUARDIANS": "MLB",
  "CLEVELAND INDIANS": "MLB",
  "DETROIT TIGERS": "MLB",
  "HOUSTON ASTROS": "MLB",
  "KANSAS CITY ROYALS": "MLB",
  "LOS ANGELES ANGELS": "MLB",
  "LOS ANGELES DODGERS": "MLB",
  "MIAMI MARLINS": "MLB",
  "MILWAUKEE BREWERS": "MLB",
  "NEW YORK METS": "MLB",
  "NEW YORK YANKEES": "MLB",
  "OAKLAND ATHLETICS": "MLB",
  "PHILADELPHIA PHILLIES": "MLB",
  "PITTSBURGH PIRATES": "MLB",
  "SAN DIEGO PADRES": "MLB",
  "SAN FRANCISCO GIANTS": "MLB",
  "SEATTLE MARINERS": "MLB",
  "ST LOUIS CARDINALS": "MLB",
  "TAMPA BAY RAYS": "MLB",
  "TEXAS RANGERS": "MLB",
  "TORONTO BLUE JAYS": "MLB",

  // NBA
  "BOSTON CELTICS": "NBA",
  "MINNESOTA TIMBERWOLVES": "NBA",
  "NEW YORK KNICKS": "NBA",
  "PHILADELPHIA 76ERS": "NBA",

  // NCAA
  "ALABAMA CRIMSON TIDE": "NCAA",
  "ARIZONA STATE SUN DEVILS": "NCAA",
  "FLORIDA GATORS": "NCAA",
  "GEORGIA BULLDOGS": "NCAA",
  "GEORGIA TECH YELLOW JACKETS": "NCAA",
  "INDIANA HOOSIERS": "NCAA",
  "IOWA HAWKEYES": "NCAA",
  "LSU TIGERS": "NCAA",
  "MIAMI HURRICANES": "NCAA",
  "MICHIGAN WOLVERINES": "NCAA",
  "MISSOURI TIGERS": "NCAA",
  "NORTH CAROLINA TAR HEELS": "NCAA",
  "NOTRE DAME FIGHTING IRISH": "NCAA",
  "OHIO STATE BUCKEYES": "NCAA",
  "OKLAHOMA SOONERS": "NCAA",
  "OLE MISS REBELS": "NCAA",
  "OREGON DUCKS": "NCAA",
  "PENN STATE NITTANY LIONS": "NCAA",
  "TEXAS A&M AGGIES": "NCAA",
  "TEXAS LONGHORNS": "NCAA",
  "TEXAS TECH RED RAIDERS": "NCAA",
  "USC TROJANS": "NCAA",

  // NFL
  "ARIZONA CARDINALS": "NFL",
  "ATLANTA FALCONS": "NFL",
  "BALTIMORE RAVENS": "NFL",
  "BUFFALO BILLS": "NFL",
  "CAROLINA PANTHERS": "NFL",
  "CHICAGO BEARS": "NFL",
  "CINCINNATI BENGALS": "NFL",
  "CLEVELAND BROWNS": "NFL",
  "DALLAS COWBOYS": "NFL",
  "DENVER BRONCOS": "NFL",
  "DETROIT LIONS": "NFL",
  "GREEN BAY PACKERS": "NFL",
  "HOUSTON OILERS": "NFL",
  "HOUSTON TEXANS": "NFL",
  "INDIANAPOLIS COLTS": "NFL",
  "JACKSONVILLE JAGUARS": "NFL",
  "KANSAS CITY CHIEFS": "NFL",
  "LAS VEGAS RAIDERS": "NFL",
  "LOS ANGELES CHARGERS": "NFL",
  "LOS ANGELES RAMS": "NFL",
  "MIAMI DOLPHINS": "NFL",
  "MINNESOTA VIKINGS": "NFL",
  "NEW ENGLAND PATRIOTS": "NFL",
  "NEW ORLEANS SAINTS": "NFL",
  "NEW YORK GIANTS": "NFL",
  "NEW YORK JETS": "NFL",
  "OAKLAND RAIDERS": "NFL",
  "PHILADELPHIA EAGLES": "NFL",
  "PITTSBURGH STEELERS": "NFL",
  "SAN DIEGO CHARGERS": "NFL",
  "SAN FRANCISCO 49ERS": "NFL",
  "SEATTLE SEAHAWKS": "NFL",
  "ST. LOUIS RAMS": "NFL",
  "TAMPA BAY BUCCANEERS": "NFL",
  "TENNESSEE TITANS": "NFL",
  "WASHINGTON COMMANDERS": "NFL",
  "WASHINGTON REDSKINS": "NFL",

  // NHL
  "CHICAGO BLACKHAWKS": "NHL",
  "COLORADO AVALANCHE": "NHL",
  "DETROIT RED WINGS": "NHL",
  "FLORIDA PANTHERS": "NHL",
  "SAN JOSE SHARKS": "NHL",
  "WASHINGTON CAPITALS": "NHL",

  // SOCCER
  "ARGENTINA": "SOCCER",
  "BRAZIL": "SOCCER",
  "CAPE VERDE": "SOCCER",
  "ENGLAND": "SOCCER",
  "FRANCE": "SOCCER",
  "JORDAN": "SOCCER",
  "NORWAY": "SOCCER",
  "PORTUGAL": "SOCCER",
  "SOUTH AFRICA": "SOCCER",
  "TEAM ARGENTINA": "SOCCER",
  "TEAM AUSTRALIA": "SOCCER",
  "TEAM BELGIUM": "SOCCER",
  "TEAM BRAZIL": "SOCCER",
  "TEAM COLOMBIA": "SOCCER",
  "TEAM EGYPT": "SOCCER",
  "TEAM ENGLAND": "SOCCER",
  "TEAM FRANCE": "SOCCER",
  "TEAM GERMANY": "SOCCER",
  "TEAM ITALY": "SOCCER",
  "TEAM IVORY COAST": "SOCCER",
  "TEAM JAPAN": "SOCCER",
  "TEAM MEXICO": "SOCCER",
  "TEAM MOROCCO": "SOCCER",
  "TEAM NETHERLANDS": "SOCCER",
  "TEAM NORWAY": "SOCCER",
  "TEAM PARAGUAY": "SOCCER",
  "TEAM PERU": "SOCCER",
  "TEAM PORTUGAL": "SOCCER",
  "TEAM SAUDI ARABIA": "SOCCER",
  "TEAM SCOTLAND": "SOCCER",
  "TEAM SOUTH KOREA": "SOCCER",
  "TEAM SPAIN": "SOCCER",
  "TEAM SWEDEN": "SOCCER",
  "TEAM SWITZERLAND": "SOCCER",
  "TEAM USA": "SOCCER",
  "TEAM VENEZUELA": "SOCCER",
  "TURKIYE": "SOCCER",
}

/** Longest match first, so "NEW YORK GIANTS" is not shadowed by a shorter entry. */
export const TEAM_KEYS = Object.keys(TEAM_LEAGUE).sort((a, b) => b.length - a.length)

/** The team named in a title, or null. Never a positional guess. */
export function teamInTitle(title: string): string | null {
  const upper = title.toUpperCase()
  return TEAM_KEYS.find((t) => upper.includes(t)) ?? null
}
