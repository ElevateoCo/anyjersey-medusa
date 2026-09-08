import unicodedata

"""Vocabularies for parsing product titles.

The source catalog has no usable taxonomy: 4,014 of 4,205 products carry the single
tag "jersey", productType is one of four values, and the custom.team/sport/player
metafields are set on 60 products. Titles, however, are structured:

    BUFFALO BILLS JOSH ALLEN GREY JERSEY
    JACKSONVILLE JAGUARS ANTON HARRISON COLOR RUSH JERSEY
    1994 WORLD CUP ROMARIO TEAM BRAZIL YELLOW JERSEY

So team, player, colourway, edition and season are recovered by parsing, and
everything that cannot be recovered is flagged for review rather than guessed.
"""

TEAMS = {
 'NCAA': """Alabama Crimson Tide|Ohio State Buckeyes|Michigan Wolverines|Georgia Bulldogs|
 Texas Longhorns|LSU Tigers|Oklahoma Sooners|Notre Dame Fighting Irish|Clemson Tigers|
 Florida State Seminoles|Penn State Nittany Lions|Oregon Ducks|USC Trojans|UCLA Bruins|
 Tennessee Volunteers|Auburn Tigers|Texas A&M Aggies|Wisconsin Badgers|Iowa Hawkeyes|
 Nebraska Cornhuskers|Miami Hurricanes|Florida Gators|Arkansas Razorbacks|Kentucky Wildcats|
 South Carolina Gamecocks|Missouri Tigers|Mississippi State Bulldogs|Ole Miss Rebels|
 Oklahoma State Cowboys|Baylor Bears|TCU Horned Frogs|Kansas Jayhawks|Kansas State Wildcats|
 West Virginia Mountaineers|Virginia Tech Hokies|North Carolina Tar Heels|NC State Wolfpack|
 Duke Blue Devils|Louisville Cardinals|Pittsburgh Panthers|Syracuse Orange|Boston College Eagles|
 Michigan State Spartans|Minnesota Golden Gophers|Illinois Fighting Illini|Indiana Hoosiers|
 Purdue Boilermakers|Maryland Terrapins|Rutgers Scarlet Knights|Northwestern Wildcats|
 Washington Huskies|Utah Utes|Arizona Wildcats|Arizona State Sun Devils|Colorado Buffaloes|
 California Golden Bears|Stanford Cardinal|Oregon State Beavers|Washington State Cougars|
 BYU Cougars|Cincinnati Bearcats|Houston Cougars|UCF Knights|Memphis Tigers|Navy Midshipmen|
 Army Black Knights|Air Force Falcons|Boise State Broncos|San Diego State Aztecs|
 Colorado State Rams|Fresno State Bulldogs|Texas Tech Red Raiders|Iowa State Cyclones|
 Georgia Tech Yellow Jackets|Virginia Cavaliers|Wake Forest Demon Deacons|Crimson Tide""",

 'CLUB': """Manchester United|Manchester City|Real Madrid|Barcelona|Liverpool|Chelsea|Arsenal|
 Tottenham|Bayern Munich|Borussia Dortmund|Juventus|AC Milan|Inter Milan|Napoli|AS Roma|
 Paris Saint-Germain|PSG|Atletico Madrid|Sevilla|Valencia|Ajax|PSV|Benfica|Porto|
 Sporting Lisbon|Celtic|Rangers FC|Newcastle United|Aston Villa|West Ham|Everton|Leeds United|
 Bayer Leverkusen|RB Leipzig|Lazio|Fiorentina|Atalanta|Marseille|Lyon|Monaco|Boca Juniors|
 River Plate|Flamengo|Palmeiras|Santos|Corinthians|Club America|Chivas|LA Galaxy|Inter Miami|
 Al Nassr|Al Hilal|Galatasaray|Fenerbahce|Besiktas""",

 'NFL': """Arizona Cardinals|Atlanta Falcons|Baltimore Ravens|Buffalo Bills|Carolina Panthers|
 Chicago Bears|Cincinnati Bengals|Cleveland Browns|Dallas Cowboys|Denver Broncos|Detroit Lions|
 Green Bay Packers|Houston Texans|Indianapolis Colts|Jacksonville Jaguars|Kansas City Chiefs|
 Las Vegas Raiders|Los Angeles Chargers|Los Angeles Rams|Miami Dolphins|Minnesota Vikings|
 New England Patriots|New Orleans Saints|New York Giants|New York Jets|Philadelphia Eagles|
 Pittsburgh Steelers|San Francisco 49ers|Seattle Seahawks|Tampa Bay Buccaneers|Tennessee Titans|
 Washington Commanders|Oakland Raiders|San Diego Chargers|Washington Redskins""",

 'NBA': """Atlanta Hawks|Boston Celtics|Brooklyn Nets|Charlotte Hornets|Chicago Bulls|
 Cleveland Cavaliers|Dallas Mavericks|Denver Nuggets|Detroit Pistons|Golden State Warriors|
 Houston Rockets|Indiana Pacers|Los Angeles Clippers|LA Clippers|Los Angeles Lakers|
 Memphis Grizzlies|Miami Heat|Milwaukee Bucks|Minnesota Timberwolves|New Orleans Pelicans|
 New York Knicks|Oklahoma City Thunder|Orlando Magic|Philadelphia 76ers|Phoenix Suns|
 Portland Trail Blazers|Sacramento Kings|San Antonio Spurs|Toronto Raptors|Utah Jazz|
 Washington Wizards|Seattle Supersonics|New Jersey Nets""",

 'MLB': """Arizona Diamondbacks|Atlanta Braves|Baltimore Orioles|Boston Red Sox|Chicago Cubs|
 Chicago White Sox|Cincinnati Reds|Cleveland Guardians|Cleveland Indians|Colorado Rockies|
 Detroit Tigers|Houston Astros|Kansas City Royals|Los Angeles Angels|Los Angeles Dodgers|
 Miami Marlins|Milwaukee Brewers|Minnesota Twins|New York Mets|New York Yankees|
 Oakland Athletics|Philadelphia Phillies|Pittsburgh Pirates|San Diego Padres|
 San Francisco Giants|Seattle Mariners|St. Louis Cardinals|St Louis Cardinals|Tampa Bay Rays|
 Texas Rangers|Toronto Blue Jays|Washington Nationals|Brooklyn Dodgers|Montreal Expos""",

 'NHL': """Anaheim Ducks|Arizona Coyotes|Boston Bruins|Buffalo Sabres|Calgary Flames|
 Carolina Hurricanes|Chicago Blackhawks|Colorado Avalanche|Columbus Blue Jackets|Dallas Stars|
 Detroit Red Wings|Edmonton Oilers|Florida Panthers|Los Angeles Kings|Minnesota Wild|
 Montreal Canadiens|Nashville Predators|New Jersey Devils|New York Islanders|New York Rangers|
 Ottawa Senators|Philadelphia Flyers|Pittsburgh Penguins|San Jose Sharks|Seattle Kraken|
 St. Louis Blues|St Louis Blues|Tampa Bay Lightning|Toronto Maple Leafs|Utah Hockey Club|
 Vancouver Canucks|Vegas Golden Knights|Washington Capitals|Winnipeg Jets|Quebec Nordiques""",

 'SOCCER': """Team Brazil|Team Argentina|Team Mexico|Team Germany|Team France|Team Spain|
 Team Italy|Team England|Team Portugal|Team Netherlands|Team Belgium|Team Croatia|Team Morocco|
 Team Japan|Team South Korea|Team USA|Team Canada|Team Uruguay|Team Colombia|Team Chile|
 Team Poland|Team Denmark|Team Sweden|Team Switzerland|Team Senegal|Team Nigeria|Team Ghana|
 Team Cameroon|Team Egypt|Team Australia|Team Saudi Arabia|Team Qatar|Team Ecuador|Team Peru|
 Team Serbia|Team Wales|Team Scotland|Team Ireland|Team Austria|Team Ukraine|Team Turkey|
 Team Greece|Team Norway|Team Iran|Team Tunisia|Team Algeria|Team Ivory Coast|Team Costa Rica|
 Team Jamaica|Team Honduras|Team Panama|Team Paraguay|Team Venezuela|Team Bolivia|
 Brazil|Argentina|Mexico|Germany|France|Spain|Italy|England|Portugal|Netherlands|Belgium|
 Croatia|Morocco|Japan|South Korea|Uruguay|Colombia|Senegal|Nigeria|Ghana|Cameroon|Egypt""",
}

LEAGUE_SPORT = {
    'NFL': 'football', 'NBA': 'basketball', 'MLB': 'baseball', 'NHL': 'hockey',
    'SOCCER': 'soccer', 'NCAA': 'college football', 'UFC': 'mma', 'CLUB': 'soccer',
}

# Longest phrases first so "COLOR RUSH" wins over "RUSH" and "CITY EDITION" over "CITY".
EDITIONS = [
    'color rush', 'colour rush', 'colorush', 'rivalry', 'rival', 'vintage',
    'windbreaker', 'primary', 'secondary', 'combo', 'split', 'gradient', 'blackout', 'city edition', 'statement edition', 'association edition',
    'icon edition', 'earned edition', 'classic edition', 'all star', 'all-star',
    'throwback', 'alternate', 'inaugural', 'swingman', 'authentic', 'replica',
    'longsleeve', 'long sleeve', 'retro', 'vapor', 'elite', 'legend', 'limited',
    'finals', 'home', 'away', 'game', 'pro',
]

COLOURS = [
    # multi-word first so "baby blue" beats "blue" and "kelly green" beats "green"
    'baby blue', 'sky blue', 'royal blue', 'navy blue', 'powder blue', 'ice blue',
    'forest green', 'kelly green', 'lime green', 'mint green', 'olive green',
    'creamsicle', 'off white', 'bone white', 'jet black', 'rose gold',
    'burgundy', 'charcoal', 'lavender', 'scarlet', 'crimson', 'maroon', 'orange',
    'purple', 'yellow', 'silver', 'cream', 'beige', 'black', 'white', 'green',
    'brown', 'royal', 'camo', 'gold', 'grey', 'gray', 'navy', 'mint', 'pink',
    'teal', 'blue', 'red', 'tan', 'sky',
]

GARMENTS = [
    ('longsleeve jersey', 'longsleeve-jersey'), ('long sleeve jersey', 'longsleeve-jersey'),
    ('sweatshirt', 'sweatshirt'), ('t-shirt', 'tshirt'), ('jersey', 'jersey'),
    ('shorts', 'shorts'), ('hoodie', 'hoodie'), ('jacket', 'jacket'),
    ('pants', 'pants'), ('hat', 'hat'), ('cap', 'cap'), ('tee', 'tshirt'),
    ('windbreaker jacket', 'jacket'), ('windbreaker', 'jacket'), ('combo', 'set'),
]

# Canonical sizes. 143 distinct raw values collapse onto these.
SIZE_MAP = {
    'xs': ('XS', 'adult'), 'extra small': ('XS', 'adult'),
    's': ('S', 'adult'), 'small': ('S', 'adult'),
    'm': ('M', 'adult'), 'medium': ('M', 'adult'),
    'l': ('L', 'adult'), 'large': ('L', 'adult'),
    'xl': ('XL', 'adult'), 'extra large': ('XL', 'adult'), 'x large': ('XL', 'adult'),
    'xxl': ('2XL', 'adult'), '2xl': ('2XL', 'adult'), 'xx large': ('2XL', 'adult'),
    'xxxl': ('3XL', 'adult'), '3xl': ('3XL', 'adult'),
    'xxxxl': ('4XL', 'adult'), '4xl': ('4XL', 'adult'),
    'xxxxxl': ('5XL', 'adult'), '5xl': ('5XL', 'adult'),
    '6xl': ('6XL', 'adult'),
    'ys': ('YS', 'youth'), 'youth s': ('YS', 'youth'), 'youth small': ('YS', 'youth'),
    'ym': ('YM', 'youth'), 'youth m': ('YM', 'youth'), 'youth medium': ('YM', 'youth'),
    'yl': ('YL', 'youth'), 'youth l': ('YL', 'youth'), 'youth large': ('YL', 'youth'),
    'yxl': ('YXL', 'youth'), 'youth xl': ('YXL', 'youth'),
    'youth xxl': ('Y2XL', 'youth'), 'y2xl': ('Y2XL', 'youth'),
    '7xl': ('7XL', 'adult'), '8xl': ('8XL', 'adult'), '9xl': ('9XL', 'adult'),
    '10xl': ('10XL', 'adult'),
    '2x': ('2XL', 'adult'), '3x': ('3XL', 'adult'), '4x': ('4XL', 'adult'),
    '5x': ('5XL', 'adult'), 'sm': ('S', 'adult'), 'md': ('M', 'adult'), 'lg': ('L', 'adult'),
    'default title': ('ONE', 'one-size'), 'one size': ('ONE', 'one-size'),
    'os': ('ONE', 'one-size'), 'one': ('ONE', 'one-size'),
}


# Bare national-team names, matched as a fallback after franchise names.
# The catalog is heavy on World Cup product where the nation appears with or
# without a "TEAM" prefix ("TEAM CAPE VERDE", "World Cup Norway Windbreaker").
NATIONS = """Turkiye|Argentina|Australia|Austria|Belgium|Bolivia|Bosnia|Brazil|Cameroon|Canada|
 Cape Verde|Chile|Colombia|Costa Rica|Croatia|Curacao|Czech Republic|Denmark|Ecuador|Egypt|
 England|Finland|France|Germany|Ghana|Greece|Haiti|Honduras|Hungary|Iceland|Iran|Iraq|Ireland|
 Italy|Ivory Coast|Jamaica|Japan|Jordan|Mexico|Morocco|Netherlands|New Zealand|Nigeria|Norway|
 Panama|Paraguay|Peru|Poland|Portugal|Qatar|Romania|Russia|Saudi Arabia|Scotland|Senegal|Serbia|
 Slovakia|Slovenia|South Africa|South Korea|Spain|Sweden|Switzerland|Tunisia|Turkey|Ukraine|
 United States|Uruguay|Uzbekistan|Venezuela|Wales|Algeria|Angola|Benin|Burkina Faso|Congo|
 Gabon|Guinea|Kenya|Libya|Mali|Mozambique|Namibia|Sudan|Tanzania|Togo|Uganda|Zambia|Zimbabwe|
 Bahrain|Kuwait|Lebanon|Oman|Palestine|Syria|Yemen|China|India|Indonesia|Malaysia|Philippines|
 Singapore|Thailand|Vietnam|Bulgaria|Belarus|Estonia|Georgia|Latvia|Lithuania|Moldova|
 Montenegro|North Macedonia|Albania|Armenia|Azerbaijan|Cyprus|Israel|Kazakhstan|Luxembourg|
 Malta|Cuba|Guatemala|Nicaragua|El Salvador|Trinidad|Suriname|Guyana|Belize|Bermuda"""

# Garment cut. "Mens S" and "Womens S" on one product are different variants,
# not duplicates to collapse, so fit is its own dimension.
FIT_PREFIXES = [
    ('womens', 'womens'), ("women's", 'womens'), ('women', 'womens'), ('ladies', 'womens'),
    ('womans', 'womens'), ("woman's", 'womens'), ('woman', 'womens'),
    ('mens', 'mens'), ("men's", 'mens'), ('men', 'mens'),
    ('youth', 'youth'), ('kids', 'youth'), ('child', 'youth'), ('boys', 'youth'),
    ('adult', 'unisex'), ('unisex', 'unisex'),
]


# ---------------------------------------------------------------- aliases
# Misspellings and short forms found in the live catalog. These are not parser
# shortcomings — the product titles on the store are genuinely misspelled, which means
# they are also misspelled for customers and for search engines. Worth fixing at source;
# until then, mapped here so the taxonomy still resolves.
#
# (alias, canonical team, league)
ALIASES = [
    # --- misspellings, with the number of affected products found on 2026-08-22 ---
    ('philidelphia eagles', 'Philadelphia Eagles', 'NFL'),        # 35
    ('norte dame fighting irish', 'Notre Dame Fighting Irish', 'NCAA'),  # 33
    ('norte dame', 'Notre Dame Fighting Irish', 'NCAA'),
    ('boston red socks', 'Boston Red Sox', 'MLB'),                # 13
    ('red socks', 'Boston Red Sox', 'MLB'),
    ('tejas rangers', 'Texas Rangers', 'MLB'),                    # 7
    ('flordia gators', 'Florida Gators', 'NCAA'),                 # 7
    ('cincinatti bengals', 'Cincinnati Bengals', 'NFL'),
    ('pittsburg steelers', 'Pittsburgh Steelers', 'NFL'),
    ('green bay packer', 'Green Bay Packers', 'NFL'),
    ('sanfrancisco 49ers', 'San Francisco 49ers', 'NFL'),
    ('la lakers', 'Los Angeles Lakers', 'NBA'),
    ('ny yankees', 'New York Yankees', 'MLB'),
    ('ny knicks', 'New York Knicks', 'NBA'),

    # --- historic and relocated franchises ---
    ('houston oilers', 'Houston Oilers', 'NFL'),                  # 8
    ('st. louis rams', 'St. Louis Rams', 'NFL'),
    ('st louis rams', 'St. Louis Rams', 'NFL'),
    ('los angeles raiders', 'Los Angeles Raiders', 'NFL'),
    ('tennessee oilers', 'Tennessee Oilers', 'NFL'),

    # --- programme names without the mascot, as the titles write them ---
    ('arizona state', 'Arizona State Sun Devils', 'NCAA'),
    ('notre dame', 'Notre Dame Fighting Irish', 'NCAA'),
    ('ohio state', 'Ohio State Buckeyes', 'NCAA'),
    ('penn state', 'Penn State Nittany Lions', 'NCAA'),
    ('michigan state', 'Michigan State Spartans', 'NCAA'),
    ('florida state', 'Florida State Seminoles', 'NCAA'),
    ('oklahoma state', 'Oklahoma State Cowboys', 'NCAA'),
    ('texas tech', 'Texas Tech Red Raiders', 'NCAA'),
    ('georgia tech', 'Georgia Tech Yellow Jackets', 'NCAA'),
    ('boise state', 'Boise State Broncos', 'NCAA'),
    ('iowa state', 'Iowa State Cyclones', 'NCAA'),
    ('kansas state', 'Kansas State Wildcats', 'NCAA'),
    ('oregon state', 'Oregon State Beavers', 'NCAA'),
    ('washington state', 'Washington State Cougars', 'NCAA'),
    ('colorado state', 'Colorado State Rams', 'NCAA'),
    ('fresno state', 'Fresno State Bulldogs', 'NCAA'),
    ('san diego state', 'San Diego State Aztecs', 'NCAA'),
    ('ole miss', 'Ole Miss Rebels', 'NCAA'),
    ('texas a&m', 'Texas A&M Aggies', 'NCAA'),
]

# ---------------------------------------------------------------- city + sport
# Titles like "Adley Rutschman Baltimore Baseball Jersey" name a city and a sport but no
# team. Resolved only where the city has exactly ONE franchise in that sport — New York,
# Los Angeles and Chicago baseball are genuinely ambiguous and stay unresolved rather
# than being guessed.
CITY_SPORT = {
    ('baltimore', 'baseball'): ('Baltimore Orioles', 'MLB'),
    ('kansas city', 'baseball'): ('Kansas City Royals', 'MLB'),
    ('san francisco', 'baseball'): ('San Francisco Giants', 'MLB'),
    ('houston', 'baseball'): ('Houston Astros', 'MLB'),
    ('seattle', 'baseball'): ('Seattle Mariners', 'MLB'),
    ('atlanta', 'baseball'): ('Atlanta Braves', 'MLB'),
    ('detroit', 'baseball'): ('Detroit Tigers', 'MLB'),
    ('philadelphia', 'baseball'): ('Philadelphia Phillies', 'MLB'),
    ('pittsburgh', 'baseball'): ('Pittsburgh Pirates', 'MLB'),
    ('cleveland', 'baseball'): ('Cleveland Guardians', 'MLB'),
    ('cincinnati', 'baseball'): ('Cincinnati Reds', 'MLB'),
    ('milwaukee', 'baseball'): ('Milwaukee Brewers', 'MLB'),
    ('minnesota', 'baseball'): ('Minnesota Twins', 'MLB'),
    ('colorado', 'baseball'): ('Colorado Rockies', 'MLB'),
    ('arizona', 'baseball'): ('Arizona Diamondbacks', 'MLB'),
    ('san diego', 'baseball'): ('San Diego Padres', 'MLB'),
    ('toronto', 'baseball'): ('Toronto Blue Jays', 'MLB'),
    ('boston', 'baseball'): ('Boston Red Sox', 'MLB'),
    ('miami', 'baseball'): ('Miami Marlins', 'MLB'),
    ('washington', 'baseball'): ('Washington Nationals', 'MLB'),
    ('texas', 'baseball'): ('Texas Rangers', 'MLB'),
    ('tampa bay', 'baseball'): ('Tampa Bay Rays', 'MLB'),
    ('oakland', 'baseball'): ('Oakland Athletics', 'MLB'),
    ('st. louis', 'baseball'): ('St. Louis Cardinals', 'MLB'),
    ('st louis', 'baseball'): ('St. Louis Cardinals', 'MLB'),

    # Basketball. Added when the live-store sync surfaced 447 new NBA products titled with
    # the city alone — "Stephen Curry Golden State Basketball Jersey" — which left 39 of
    # them with no team and therefore out of the team facet entirely.
    #
    # Two cities field two NBA teams, so they are deliberately absent: 'los angeles'
    # (Lakers and Clippers) and 'new york' (Knicks and Nets). Guessing one would file a
    # Clippers shirt under the Lakers, and a wrong team is worse than a missing one — those
    # titles fall through to needs_review, which is what it is for.
    ('golden state', 'basketball'): ('Golden State Warriors', 'NBA'),
    ('san antonio', 'basketball'): ('San Antonio Spurs', 'NBA'),
    ('oklahoma city', 'basketball'): ('Oklahoma City Thunder', 'NBA'),
    ('minnesota', 'basketball'): ('Minnesota Timberwolves', 'NBA'),
    ('boston', 'basketball'): ('Boston Celtics', 'NBA'),
    ('denver', 'basketball'): ('Denver Nuggets', 'NBA'),
    ('milwaukee', 'basketball'): ('Milwaukee Bucks', 'NBA'),
    ('detroit', 'basketball'): ('Detroit Pistons', 'NBA'),
    ('houston', 'basketball'): ('Houston Rockets', 'NBA'),
    ('phoenix', 'basketball'): ('Phoenix Suns', 'NBA'),
    ('memphis', 'basketball'): ('Memphis Grizzlies', 'NBA'),
    ('new orleans', 'basketball'): ('New Orleans Pelicans', 'NBA'),
    ('portland', 'basketball'): ('Portland Trail Blazers', 'NBA'),
    ('philadelphia', 'basketball'): ('Philadelphia 76ers', 'NBA'),
    ('atlanta', 'basketball'): ('Atlanta Hawks', 'NBA'),
    ('cleveland', 'basketball'): ('Cleveland Cavaliers', 'NBA'),
    ('indiana', 'basketball'): ('Indiana Pacers', 'NBA'),
    ('orlando', 'basketball'): ('Orlando Magic', 'NBA'),
    ('dallas', 'basketball'): ('Dallas Mavericks', 'NBA'),
    ('miami', 'basketball'): ('Miami Heat', 'NBA'),
    ('chicago', 'basketball'): ('Chicago Bulls', 'NBA'),
    ('sacramento', 'basketball'): ('Sacramento Kings', 'NBA'),
    ('utah', 'basketball'): ('Utah Jazz', 'NBA'),
    ('toronto', 'basketball'): ('Toronto Raptors', 'NBA'),
    ('washington', 'basketball'): ('Washington Wizards', 'NBA'),
    ('charlotte', 'basketball'): ('Charlotte Hornets', 'NBA'),
    ('brooklyn', 'basketball'): ('Brooklyn Nets', 'NBA'),
}


def fold(*parts) -> str:
    """Accent-folded, lowercased search haystack.

    Postgres ILIKE will not match "romario" against "Romário", and nobody types the
    accent — José Altuve, Julio Rodríguez, Ronald Acuña Jr. and Romário all returned
    nothing before this existed. Folded once at write time rather than on every query.
    """
    joined = ' '.join(p for p in parts if p)
    ascii_only = unicodedata.normalize('NFKD', joined).encode('ascii', 'ignore').decode()
    return ' '.join(ascii_only.lower().split())
