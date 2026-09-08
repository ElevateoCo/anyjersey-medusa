"""Title parsing, size normalisation and SKU generation.

These three are tested first because each one caused a real defect during the build:
a colour leaking into the player name, "Mens S" and "Womens S" collapsing into one
variant, and 819 duplicate SKUs surviving into a schema with a unique constraint.
"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extract import parse_title, norm_size, make_sku, slugify, title_case, cents  # noqa: E402


class TestParseTitle(unittest.TestCase):
    def test_nfl_team_player_colour(self):
        r = parse_title('BUFFALO BILLS JOSH ALLEN GREY JERSEY')
        self.assertEqual(r['team'], 'Buffalo Bills')
        self.assertEqual(r['league'], 'NFL')
        self.assertEqual(r['sport'], 'football')
        self.assertEqual(r['player'], 'Josh Allen')
        self.assertEqual(r['colourway'], 'grey')
        self.assertEqual(r['garment'], 'jersey')

    def test_longest_team_match_wins(self):
        """"Chicago White Sox" must not resolve as "Chicago Cubs" or "Chicago Bears"."""
        self.assertEqual(parse_title('CHICAGO WHITE SOX LUIS ROBERT WHITE JERSEY')['team'],
                         'Chicago White Sox')
        self.assertEqual(parse_title('NEW YORK RANGERS ARTEMI PANARIN BLUE JERSEY')['team'],
                         'New York Rangers')
        self.assertEqual(parse_title('TEXAS RANGERS COREY SEAGER BLUE JERSEY')['team'],
                         'Texas Rangers')

    def test_multiword_edition_beats_substring(self):
        r = parse_title('JACKSONVILLE JAGUARS ANTON HARRISON COLOR RUSH JERSEY')
        self.assertEqual(r['edition'], 'color rush')
        self.assertEqual(r['player'], 'Anton Harrison')

    def test_season_range_and_single_year(self):
        self.assertEqual(parse_title('2014-2015 WORLD CUP JAMES RODRIGUEZ YELLOW JERSEY')['season'],
                         '2014-2015')
        self.assertEqual(parse_title('1994 WORLD CUP ROMARIO TEAM BRAZIL YELLOW JERSEY')['season'],
                         '1994')

    def test_national_team_with_and_without_prefix(self):
        self.assertEqual(parse_title('2026 WORLD CUP TEAM CAPE VERDE BLUE JERSEY')['team'],
                         'Cape Verde')
        self.assertEqual(parse_title('2026 World Cup Norway Windbreaker Jacket')['team'], 'Norway')

    def test_misspellings_from_the_source_catalog(self):
        """These titles are genuinely misspelled on the live store."""
        for title, want in [
            ('PHILIDELPHIA EAGLES BRIAN BRANCH GREEN JERSEY', 'Philadelphia Eagles'),
            ('NORTE DAME FIGHTING IRISH JEREMIYAH LOVE BLUE JERSEY', 'Notre Dame Fighting Irish'),
            ('BOSTON RED SOCKS RAFAEL DEVERS RED JERSEY', 'Boston Red Sox'),
            ('TEJAS RANGERS COREY SEAGER WHITE JERSEY', 'Texas Rangers'),
            ('FLORDIA GATORS DJ LAGWAY BLUE JERSEY', 'Florida Gators'),
        ]:
            self.assertEqual(parse_title(title)['team'], want, title)

    def test_city_plus_sport_resolves_only_when_unambiguous(self):
        self.assertEqual(parse_title('Adley Rutschman Baltimore Baseball Jersey')['team'],
                         'Baltimore Orioles')
        # New York has two baseball franchises — guessing would be worse than not resolving
        self.assertIsNone(parse_title('Aaron Judge New York Baseball Jersey')['team'])

    def test_every_colour_mention_is_consumed(self):
        """A second colour must not leak into the player name."""
        r = parse_title('ALEX PEREIRA RED AND BLUE COMBO')
        self.assertEqual(r['colourway'], 'blue')  # 'baby blue'-style multiword first, then order
        self.assertNotIn('red', (r['player'] or '').lower())
        self.assertNotIn('blue', (r['player'] or '').lower())

    def test_sport_words_do_not_become_player_names(self):
        r = parse_title('Bobby Witt Jr. Kansas City Baseball Jersey')
        self.assertNotIn('baseball', (r['player'] or '').lower())

    def test_unresolvable_title_returns_nones_not_garbage(self):
        r = parse_title('Untitled Aug15_02:56:03')
        self.assertIsNone(r['team'])
        self.assertIsNone(r['colourway'])

    def test_garment_variants(self):
        self.assertEqual(parse_title('CLEVELAND CAVALIERS BLUE RETRO SHORTS')['garment'], 'shorts')
        self.assertEqual(parse_title('2014 WORLD CUP JAMES RODRIGUEZ YELLOW LONGSLEEVE JERSEY')['garment'],
                         'longsleeve-jersey')
        self.assertEqual(parse_title('2026 World Cup USA Windbreaker Jacket')['garment'], 'jacket')


class TestNormSize(unittest.TestCase):
    def test_canonical_passthrough(self):
        for raw in ('S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'):
            code, _label, group, fit, ok = norm_size(raw)
            self.assertTrue(ok, raw)
            self.assertEqual(code, raw)
            self.assertEqual(group, 'adult')
            self.assertEqual(fit, 'unisex')

    def test_case_and_spelling_variants_collapse(self):
        for raw, want in [('Xl', 'XL'), ('4Xl', '4XL'), ('2xl', '2XL'),
                          ('XXL', '2XL'), ('XXXL', '3XL'), ('2X', '2XL'),
                          ('Large', 'L'), ('sm', 'S'), ('  L  ', 'L')]:
            code, _l, _g, _f, ok = norm_size(raw)
            self.assertTrue(ok, raw)
            self.assertEqual(code, want, raw)

    def test_fit_is_a_separate_dimension(self):
        """The bug this prevents: Mens S and Womens S collapsing into one variant."""
        mens = norm_size('Mens S')
        womens = norm_size('Womens S')
        self.assertEqual((mens[0], mens[3]), ('S', 'mens'))
        self.assertEqual((womens[0], womens[3]), ('S', 'womens'))
        self.assertNotEqual((mens[0], mens[3]), (womens[0], womens[3]))

    def test_apostrophe_and_no_space_fit_prefixes(self):
        self.assertEqual(norm_size("Woman's small")[0], 'S')
        self.assertEqual(norm_size("Woman's small")[3], 'womens')
        self.assertEqual(norm_size('Adult2xl')[0], '2XL')
        self.assertEqual(norm_size('ADULT MEDIUM')[0], 'M')

    def test_youth_sizes(self):
        for raw, want in [('YS', 'YS'), ('Youth XL', 'YXL'), ('YM', 'YM')]:
            code, _l, group, fit, ok = norm_size(raw)
            self.assertTrue(ok, raw)
            self.assertEqual(code, want)
            self.assertEqual(group, 'youth')
            self.assertEqual(fit, 'youth')

    def test_one_size(self):
        code, _l, group, _f, ok = norm_size('Default Title')
        self.assertEqual((code, group, ok), ('ONE', 'one-size', True))

    def test_junk_is_flagged_not_guessed(self):
        for raw in ('A', 'X', 'YLYXL', 'SIZE', '4'):
            _c, _l, _g, _f, ok = norm_size(raw)
            self.assertFalse(ok, f'{raw!r} should not be recognised')


class TestSku(unittest.TestCase):
    def test_deterministic(self):
        a = make_sku('gid://shopify/Product/123', 'L')
        b = make_sku('gid://shopify/Product/123', 'L')
        self.assertEqual(a, b)

    def test_distinct_per_product_and_size(self):
        self.assertNotEqual(make_sku('gid://p/1', 'L'), make_sku('gid://p/2', 'L'))
        self.assertNotEqual(make_sku('gid://p/1', 'L'), make_sku('gid://p/1', 'XL'))

    def test_shape(self):
        sku = make_sku('gid://shopify/Product/7483309031630', '2XL')
        self.assertTrue(sku.startswith('AJ-'))
        self.assertTrue(sku.endswith('-2XL'))
        self.assertNotIn(' ', sku)

    def test_no_collisions_across_many_products(self):
        skus = {make_sku(f'gid://shopify/Product/{i}', s)
                for i in range(4000) for s in ('S', 'L', '3XL')}
        self.assertEqual(len(skus), 4000 * 3)


class TestHelpers(unittest.TestCase):
    def test_cents_never_floats(self):
        self.assertEqual(cents('64.99'), 6499)
        self.assertEqual(cents('0.00'), 0)
        self.assertEqual(cents('19.9'), 1990)
        self.assertIsNone(cents(None))
        self.assertIsNone(cents(''))

    def test_cents_rounds_rather_than_truncates(self):
        # 19.99 * 100 is 1998.9999... in binary floating point
        self.assertEqual(cents('19.99'), 1999)
        self.assertEqual(cents('0.07'), 7)

    def test_slugify(self):
        self.assertEqual(slugify('Buffalo Bills Josh Allen  GREY'),
                         'buffalo-bills-josh-allen-grey')
        self.assertEqual(slugify('Romário — Brazil'), 'romario-brazil')
        self.assertEqual(slugify('!!!'), '')

    def test_title_case_keeps_franchise_numerals_readable(self):
        self.assertEqual(title_case('SAN FRANCISCO 49ERS'), 'San Francisco 49ers')
        self.assertEqual(title_case('PHILADELPHIA 76ERS'), 'Philadelphia 76ers')

    def test_title_case_preserves_acronyms(self):
        self.assertIn('NFL', title_case('NFL SHORTS'))
        self.assertIn('USA', title_case('TEAM USA WHITE JERSEY'))


if __name__ == '__main__':
    unittest.main(verbosity=2)



class TestSearchFolding(unittest.TestCase):
    """Accent folding for the search haystack.

    Nobody types the accent: searches for Romário, José Altuve, Julio Rodríguez and
    Ronald Acuña Jr. all returned nothing until the haystack was folded at write time.
    """

    @staticmethod
    def _fold(*parts):
        from vocab import fold
        return fold(*parts)

    def test_strips_accents(self):
        self.assertEqual(self._fold('Romário'), 'romario')
        self.assertEqual(self._fold('José Altuve'), 'jose altuve')
        self.assertEqual(self._fold('Ronald Acuña Jr.'), 'ronald acuna jr.')
        self.assertEqual(self._fold('Julio Rodríguez'), 'julio rodriguez')

    def test_lowercases(self):
        self.assertEqual(self._fold('BUFFALO BILLS'), 'buffalo bills')

    def test_joins_and_collapses_whitespace(self):
        self.assertEqual(self._fold('Team  Brazil', None, 'yellow', ''), 'team brazil yellow')

    def test_skips_empty_parts(self):
        self.assertEqual(self._fold(None, '', 'NFL'), 'nfl')

    def test_handles_names_the_catalog_will_grow_into(self):
        for raw, want in [('Mbappé', 'mbappe'), ('Müller', 'muller'),
                          ('Özil', 'ozil'), ('Håland', 'haland')]:
            self.assertEqual(self._fold(raw), want)

    def test_is_idempotent(self):
        once = self._fold('José Altuve')
        self.assertEqual(self._fold(once), once)


class CitySportBasketball(unittest.TestCase):
    """City-only NBA titles, added when the live-store sync surfaced 447 new products.

    "Stephen Curry Golden State Basketball Jersey" names no team, only a city and a sport.
    Without the mapping these fell out of the team facet entirely.
    """

    def test_city_and_sport_resolve_a_team(self):
        p = parse_title('Stephen Curry Golden State Basketball Jersey')
        self.assertEqual(p['team'], 'Golden State Warriors')
        self.assertEqual(p['league'], 'NBA')

    def test_player_survives_the_city_match(self):
        p = parse_title('Nikola Jokic Denver Basketball Jersey')
        self.assertEqual(p['team'], 'Denver Nuggets')
        self.assertEqual(p['player'], 'Nikola Jokic')

    def test_two_word_city(self):
        p = parse_title('Shai Gilgeous-Alexander Oklahoma City Basketball Jersey')
        self.assertEqual(p['team'], 'Oklahoma City Thunder')

    def test_ambiguous_cities_are_left_unresolved(self):
        # Los Angeles fields the Lakers and the Clippers; New York the Knicks and the Nets.
        # A wrong team is worse than a missing one, so these fall through to needs_review.
        for title in ('Lebron James Los Angeles Basketball Jersey',
                      'Jalen Brunson New York Basketball Jersey'):
            self.assertIsNone(parse_title(title)['team'], title)

    def test_the_same_city_maps_by_sport(self):
        # Boston is the Celtics in basketball and the Red Sox in baseball.
        self.assertEqual(
            parse_title('Jayson Tatum Boston Basketball Jersey')['team'],
            'Boston Celtics')
        self.assertEqual(
            parse_title('Rafael Devers Boston Baseball Jersey')['team'],
            'Boston Red Sox')

    def test_a_full_team_name_still_wins(self):
        # The city map must not shadow an explicit team name.
        p = parse_title('Jaylen Brown Boston Celtics Green Jersey')
        self.assertEqual(p['team'], 'Boston Celtics')
