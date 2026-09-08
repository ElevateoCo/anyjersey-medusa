"""Duplicate merging.

Exercised against real CSVs in a temp directory rather than by unit-testing internals,
because the invariants that matter are all cross-file: no product may lose its images,
no SKU may collide, and collection membership must follow the survivor.
"""
import contextlib, csv, io, shutil, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dedupe  # noqa: E402


def write(d: Path, name: str, rows: list[dict]):
    with open(d / f'{name}.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def read(d: Path, name: str) -> list[dict]:
    with open(d / f'{name}.csv') as f:
        return list(csv.DictReader(f))


PRODUCT_FIELDS = dict(
    slug='', name='', status='active', sport='football', league='NFL', team='Buffalo Bills',
    player='Josh Allen', colourway='grey', season='', edition='', garment='jersey',
    price_cents='6499', compare_at_cents='', currency='USD', taxable='true',
    requires_shipping='true', description='', seo_title='', seo_description='',
    manufacturer_name='', manufacturer_address='', eu_responsible_person='',
    country_of_origin='', fibre_composition='', care_instructions='',
    safety_information='', hs_code='', source_platform='shopify', source_id='',
    source_handle='', needs_review='false', review_notes='{}',
)


def prod(pid, name, **over):
    r = {'id': pid, **PRODUCT_FIELDS}
    r['name'] = name
    r['slug'] = name.lower().replace(' ', '-')
    r['source_handle'] = f'src-{pid}'
    r.update(over)
    return r


def var(vid, pid, size, sku, pos, fit='unisex'):
    return {'id': vid, 'product_id': pid, 'sku': sku, 'size_code': size,
            'size_label': size, 'size_group': 'adult', 'fit': fit, 'position': str(pos),
            'price_cents': '', 'barcode': '', 'weight_grams': '',
            'track_inventory': 'false', 'inventory_policy': 'continue', 'source_id': vid}


class TestDedupe(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        dedupe.OUT = self.dir
        # three listings of the same shirt, each with different photos and sizes
        products = [
            prod('p1', 'Buffalo Bills Josh Allen Grey Jersey'),
            prod('p2', 'Buffalo Bills Josh Allen Grey Jersey'),
            prod('p3', 'Buffalo Bills Josh Allen Grey Jersey'),
            prod('p9', 'Dallas Cowboys CeeDee Lamb Blue Jersey', team='Dallas Cowboys',
                 player='CeeDee Lamb', colourway='blue'),
        ]
        variants = [
            var('v1', 'p1', 'S', 'SKU-1-S', 1), var('v2', 'p1', 'M', 'SKU-1-M', 2),
            var('v3', 'p2', 'L', 'SKU-2-L', 1),
            var('v4', 'p3', 'S', 'SKU-3-S', 1), var('v5', 'p3', 'XL', 'SKU-3-XL', 2),
            var('v9', 'p9', 'L', 'SKU-9-L', 1),
        ]
        media = [
            {'id': 'm1', 'sha256': 'a' * 64, 'storage_key': 'originals/a.jpg',
             'mime': 'image/jpeg', 'width': '1', 'height': '1', 'bytes': '1'},
            {'id': 'm2', 'sha256': 'b' * 64, 'storage_key': 'originals/b.jpg',
             'mime': 'image/jpeg', 'width': '1', 'height': '1', 'bytes': '1'},
            {'id': 'm3', 'sha256': 'c' * 64, 'storage_key': 'originals/c.jpg',
             'mime': 'image/jpeg', 'width': '1', 'height': '1', 'bytes': '1'},
        ]
        pmedia = [
            {'product_id': 'p1', 'media_id': 'm1', 'position': '1', 'alt': 'a'},
            {'product_id': 'p2', 'media_id': 'm2', 'position': '1', 'alt': 'b'},
            # p3 repeats m1 (same photo) and adds m3
            {'product_id': 'p3', 'media_id': 'm1', 'position': '1', 'alt': 'a'},
            {'product_id': 'p3', 'media_id': 'm3', 'position': '2', 'alt': 'c'},
            {'product_id': 'p9', 'media_id': 'm2', 'position': '1', 'alt': 'b'},
        ]
        colprods = [
            {'collection_id': 'c1', 'product_id': 'p1', 'position': '1'},
            {'collection_id': 'c1', 'product_id': 'p2', 'position': '2'},
            {'collection_id': 'c1', 'product_id': 'p9', 'position': '3'},
        ]
        write(self.dir, 'products', products)
        write(self.dir, 'variants', variants)
        write(self.dir, 'media', media)
        write(self.dir, 'product_media', pmedia)
        write(self.dir, 'collection_products', colprods)

        self.run_dedupe()

    @staticmethod
    def run_dedupe():
        """dedupe.main() prints a report; keep it out of the test output."""
        sys.argv = ['dedupe.py', '--write']
        with contextlib.redirect_stdout(io.StringIO()):
            dedupe.main()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_one_survivor_per_title(self):
        products = read(self.dir, 'products')
        names = [p['name'] for p in products]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(len(products), 2)  # one jersey group + the Cowboys product

    def test_survivor_is_the_one_with_the_most_images(self):
        products = read(self.dir, 'products')
        keeper = next(p for p in products if 'Josh Allen' in p['name'])
        self.assertEqual(keeper['id'], 'p3')  # p3 had two images

    def test_no_image_is_lost(self):
        pm = read(self.dir, 'product_media')
        keeper = next(p for p in read(self.dir, 'products') if 'Josh Allen' in p['name'])
        mids = {r['media_id'] for r in pm if r['product_id'] == keeper['id']}
        self.assertEqual(mids, {'m1', 'm2', 'm3'})

    def test_identical_photos_are_not_duplicated(self):
        """p1 and p3 shared m1 — it must appear once, not twice."""
        pm = read(self.dir, 'product_media')
        keeper = next(p for p in read(self.dir, 'products') if 'Josh Allen' in p['name'])
        rows = [r for r in pm if r['product_id'] == keeper['id']]
        self.assertEqual(len(rows), len({r['media_id'] for r in rows}))

    def test_image_positions_are_contiguous_from_one(self):
        pm = read(self.dir, 'product_media')
        for pid in {r['product_id'] for r in pm}:
            pos = sorted(int(r['position']) for r in pm if r['product_id'] == pid)
            self.assertEqual(pos, list(range(1, len(pos) + 1)))

    def test_sizes_are_unioned(self):
        v = read(self.dir, 'variants')
        keeper = next(p for p in read(self.dir, 'products') if 'Josh Allen' in p['name'])
        sizes = {x['size_code'] for x in v if x['product_id'] == keeper['id']}
        self.assertEqual(sizes, {'S', 'M', 'L', 'XL'})

    def test_no_duplicate_sku_after_merge(self):
        v = read(self.dir, 'variants')
        skus = [x['sku'] for x in v]
        self.assertEqual(len(skus), len(set(skus)))

    def test_no_duplicate_size_fit_per_product(self):
        v = read(self.dir, 'variants')
        seen = set()
        for x in v:
            key = (x['product_id'], x['size_code'], x['fit'])
            self.assertNotIn(key, seen)
            seen.add(key)

    def test_variant_positions_are_contiguous(self):
        v = read(self.dir, 'variants')
        for pid in {x['product_id'] for x in v}:
            pos = sorted(int(x['position']) for x in v if x['product_id'] == pid)
            self.assertEqual(pos, list(range(1, len(pos) + 1)))

    def test_collection_membership_follows_the_survivor(self):
        cp = read(self.dir, 'collection_products')
        pids = {r['product_id'] for r in cp}
        self.assertNotIn('p1', pids)
        self.assertNotIn('p2', pids)
        self.assertIn('p3', pids)
        self.assertIn('p9', pids)

    def test_membership_is_not_duplicated(self):
        cp = read(self.dir, 'collection_products')
        keys = [(r['collection_id'], r['product_id']) for r in cp]
        self.assertEqual(len(keys), len(set(keys)))

    def test_merge_log_records_provenance(self):
        log = read(self.dir, 'merge_log')
        self.assertEqual(len(log), 2)
        for row in log:
            self.assertEqual(row['survivor_id'], 'p3')
            self.assertIn(row['merged_id'], {'p1', 'p2'})
            self.assertTrue(row['merged_source_handle'])

    def test_untouched_product_is_unchanged(self):
        v = read(self.dir, 'variants')
        nine = [x for x in v if x['product_id'] == 'p9']
        self.assertEqual(len(nine), 1)
        self.assertEqual(nine[0]['sku'], 'SKU-9-L')

    def test_running_twice_is_a_no_op(self):
        before = read(self.dir, 'products')
        self.run_dedupe()
        self.assertEqual(read(self.dir, 'products'), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
