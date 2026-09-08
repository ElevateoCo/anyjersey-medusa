"""Description, SEO and alt-text generation.

The guarantees worth protecting here are not stylistic. They are: the copy must be
deterministic (so it does not churn between runs), it must not repeat itself across
thousands of URLs, and it must never claim sizes the product does not stock — the last
of which is a misleading-claim problem, not a copy nit (research.md §7.10).
"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from describe import build, size_sentence, seo, alt_text, pick  # noqa: E402


def product(**over):
    base = {
        'id': 'p_abc123', 'slug': 'buffalo-bills-josh-allen-grey-jersey',
        'name': 'Buffalo Bills Josh Allen Grey Jersey', 'sport': 'football',
        'league': 'NFL', 'team': 'Buffalo Bills', 'player': 'Josh Allen',
        'colourway': 'grey', 'season': '', 'edition': '', 'garment': 'jersey',
        'price_cents': '6499', 'description': '',
    }
    base.update(over)
    return base


def variants(*specs):
    return [{'size_code': c, 'fit': f} for c, f in specs]


ADULT = variants(('S', 'unisex'), ('M', 'unisex'), ('L', 'unisex'),
                 ('XL', 'unisex'), ('2XL', 'unisex'), ('3XL', 'unisex'))


class TestSizeSentence(unittest.TestCase):
    def test_states_the_real_range(self):
        self.assertEqual(size_sentence(ADULT), 'Available in unisex S–3XL.')

    def test_single_size(self):
        self.assertEqual(size_sentence(variants(('L', 'unisex'))), 'Available in unisex L.')

    def test_never_claims_fits_that_do_not_exist(self):
        """The original template said men's, youth AND women's on every product."""
        s = size_sentence(ADULT)
        for word in ("men's", "women's", 'youth'):
            self.assertNotIn(word, s)

    def test_lists_each_fit_that_does_exist(self):
        s = size_sentence(variants(('S', 'mens'), ('XL', 'mens'),
                                   ('S', 'womens'), ('L', 'womens'),
                                   ('YS', 'youth'), ('YXL', 'youth')))
        self.assertIn("men's S–XL", s)
        self.assertIn("women's S–L", s)
        self.assertIn('youth YS–YXL', s)

    def test_youth_uses_youth_ordering(self):
        s = size_sentence(variants(('YS', 'youth'), ('YM', 'youth'), ('YXL', 'youth')))
        self.assertIn('youth YS–YXL', s)

    def test_one_size(self):
        self.assertIn('one size', size_sentence(variants(('ONE', 'one-size'))))

    def test_no_variants_yields_no_claim(self):
        self.assertEqual(size_sentence([]), '')


class TestBuild(unittest.TestCase):
    def test_deterministic_across_runs(self):
        p = product()
        self.assertEqual(build(p, ADULT), build(p, ADULT))

    def test_different_products_get_different_copy(self):
        a = build(product(id='p_1'), ADULT)
        b = build(product(id='p_2', player='Stefon Diggs'), ADULT)
        self.assertNotEqual(a, b)

    def test_always_mentions_player_and_team(self):
        """Player and team are guaranteed. The colourway is not — some sentence
        templates lead with the team instead, which is intentional variety."""
        for i in range(30):
            text = build(product(id=f'p_{i}'), ADULT)
            self.assertIn('Josh Allen', text, text)
            self.assertIn('Buffalo Bills', text, text)

    def test_colourway_appears_in_most_variants(self):
        hits = sum(1 for i in range(60) if 'grey' in build(product(id=f'p_{i}'), ADULT))
        self.assertGreater(hits, 20, 'colourway should appear in a good share of templates')

    def test_degrades_without_a_player(self):
        text = build(product(player=''), ADULT)
        self.assertIn('Buffalo Bills', text)
        self.assertTrue(text.endswith('.'))
        self.assertNotIn('None', text)

    def test_degrades_without_a_team(self):
        text = build(product(team='', player='', league='', sport=''), ADULT)
        self.assertTrue(len(text) > 40)
        self.assertNotIn('None', text)

    def test_never_leaves_placeholders_or_none(self):
        for over in ({}, {'player': ''}, {'team': ''}, {'colourway': ''},
                     {'season': '1994'}, {'edition': 'retro'}, {'sport': ''}):
            text = build(product(**over), ADULT)
            for bad in ('None', '{', '}', 'undefined', '  '):
                self.assertNotIn(bad, text, f'{over} -> {text}')

    def test_past_season_reads_as_past(self):
        text = build(product(season='1994'), ADULT)
        self.assertTrue(any(w in text for w in ('remembers', 'long memory', 'were there')))

    def test_current_season_does_not_claim_nostalgia(self):
        text = build(product(season='2026'), ADULT)
        self.assertNotIn('were there', text)
        self.assertNotIn('long memory', text)

    def test_edition_is_described_when_known(self):
        self.assertIn('colour-rush', build(product(edition='color rush'), ADULT))
        self.assertIn('Retro', build(product(edition='retro'), ADULT))

    def test_makes_no_unverifiable_claims(self):
        """No fabric, no licensing, no performance claims — research.md §7.10."""
        banned = ['officially licensed', 'authentic', 'polyester', 'cotton', 'stitched',
                  'moisture', 'breathable', '100%', 'genuine']
        for over in ({}, {'season': '1998'}, {'edition': 'retro'}, {'player': ''}):
            text = build(product(**over), ADULT).lower()
            for b in banned:
                self.assertNotIn(b, text, f'{over} claimed "{b}"')

    def test_sport_vocabulary_is_used_and_never_crossed(self):
        """Not every template has a slot for sport vocabulary, so the guarantee is:
        it appears across a sample, and language from another sport never leaks in."""
        soccer_words = ('matchday', 'kickoff', 'terraces')
        football_only = ('tailgates', 'stadium')
        soccer_texts = [build(product(id=f's_{i}', sport='soccer', league='SOCCER',
                                      team='Team Brazil', player='Romário',
                                      colourway='yellow'), ADULT) for i in range(40)]
        self.assertTrue(any(any(w in t for w in soccer_words) for t in soccer_texts))
        for t in soccer_texts:
            for w in football_only:
                self.assertNotIn(w, t, t)

        baseball_texts = [build(product(id=f'b_{i}', sport='baseball'), ADULT)
                          for i in range(40)]
        self.assertTrue(any(any(w in t for w in ('ballpark', 'opening day', 'bleachers'))
                            for t in baseball_texts))

    def test_length_is_reasonable(self):
        for over in ({}, {'season': '1994'}, {'edition': 'retro'}):
            text = build(product(**over), ADULT)
            self.assertGreater(len(text), 120)
            self.assertLess(len(text), 500)

    def test_variety_across_many_products(self):
        texts = {build(product(id=f'p_{i}', player=f'Player {i}'), ADULT) for i in range(400)}
        self.assertGreater(len(texts), 380)  # near-total uniqueness


class TestSeoAndAlt(unittest.TestCase):
    def test_seo_title_within_limit(self):
        for over in ({}, {'player': 'A Very Long Player Name Indeed Yes'},
                     {'team': 'Wake Forest Demon Deacons', 'player': 'Somebody Longnamed'}):
            p = product(**over)
            title, _desc = seo(p, build(p, ADULT))
            self.assertLessEqual(len(title), 60, title)

    def test_seo_description_within_limit(self):
        p = product()
        _t, desc = seo(p, build(p, ADULT))
        self.assertLessEqual(len(desc), 155)

    def test_alt_text_describes_the_product(self):
        alt = alt_text(product(), 1)
        self.assertIn('Josh Allen', alt)
        self.assertIn('Buffalo Bills', alt)

    def test_later_images_are_numbered_not_guessed(self):
        """We do not know which view image 2 is, so it must not claim to be the back."""
        alt = alt_text(product(), 2)
        self.assertIn('view 2', alt)
        for guess in ('back', 'front', 'side', 'detail'):
            self.assertNotIn(guess, alt.lower())

    def test_alt_falls_back_to_the_name(self):
        alt = alt_text(product(team='', player='', colourway='', garment=''), 1)
        self.assertTrue(len(alt) > 5)


class TestPick(unittest.TestCase):
    def test_stable_for_the_same_seed(self):
        opts = ['a', 'b', 'c', 'd']
        self.assertEqual(pick(opts, 'seed', 'x'), pick(opts, 'seed', 'x'))

    def test_salt_changes_the_choice_space(self):
        opts = [str(i) for i in range(20)]
        self.assertNotEqual(pick(opts, 'seed', 'a'), pick(opts, 'seed', 'b'))

    def test_spreads_across_options(self):
        opts = ['a', 'b', 'c', 'd', 'e']
        got = {pick(opts, f'seed{i}') for i in range(200)}
        self.assertEqual(got, set(opts))


if __name__ == '__main__':
    unittest.main(verbosity=2)
