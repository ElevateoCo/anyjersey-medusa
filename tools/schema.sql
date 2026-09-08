-- Catalog schema for the own-stack store.
--
-- Deliberately NOT Shopify's shape. Field names are ours; no naming convention is
-- legally mandated. What *is* mandated is that certain information exists before you
-- can lawfully sell into some markets, so those live as first-class columns rather
-- than metafields: see the "regulatory" block on products (GPSR traceability, textile
-- fibre composition, country of origin). They are nullable so the import can run, and
-- NULL there is a launch blocker for EU orders, not a cosmetic gap.
--
-- Money is integer minor units (cents) + explicit currency. Never floats. See research.md §6.2.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- products

create table products (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text        not null unique,
  name                    text        not null,
  status                  text        not null default 'draft'
                                      check (status in ('active','draft','archived')),

  -- derived taxonomy: parsed from source titles, because the source has none.
  -- These are what navigation, filtering and faceted search are built on.
  sport                   text,
  league                  text,
  team                    text,
  player                  text,
  colourway               text,
  season                  text,
  edition                 text,       -- retro / color rush / alternate / city ...
  garment                 text        not null default 'jersey',

  -- commerce
  price_cents             integer     not null check (price_cents > 0),
  compare_at_cents        integer     check (compare_at_cents is null
                                             or compare_at_cents > price_cents),
  currency                char(3)     not null default 'USD',
  taxable                 boolean     not null default true,
  requires_shipping       boolean     not null default true,

  -- content
  description             text,
  seo_title               text,
  seo_description         text,

  -- regulatory. Required *information*, not required naming.
  -- GPSR: manufacturer identity + address, EU responsible person, traceability.
  -- Textile Regulation: fibre composition. Customs: country of origin.
  manufacturer_name       text,
  manufacturer_address    text,
  eu_responsible_person   text,
  country_of_origin       char(2),
  fibre_composition       text,
  care_instructions       text,
  safety_information      text,
  hs_code                 text,       -- customs classification for cross-border

  -- provenance and data quality
  source_platform         text        not null default 'shopify',
  source_id               text,
  source_handle           text,
  needs_review            boolean     not null default false,
  review_notes            text[]      not null default '{}',

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index products_status_idx    on products (status) where status = 'active';
create index products_team_idx      on products (team);
create index products_league_idx    on products (league);
create index products_player_idx    on products (player);
create index products_review_idx    on products (needs_review) where needs_review;
-- an EU order may only include products whose regulatory block is complete
create index products_eu_ready_idx  on products (id)
  where eu_responsible_person is not null and fibre_composition is not null;

-- ---------------------------------------------------------------- variants

create table variants (
  id                uuid    primary key default gen_random_uuid(),
  product_id        uuid    not null references products (id) on delete cascade,
  sku               text    not null unique,
  size_code         text    not null,   -- canonical: S M L XL 2XL 3XL 4XL 5XL YS YM YL YXL ONE
  size_label        text    not null,   -- display form
  size_group        text    not null    check (size_group in ('adult','youth','one-size')),
  fit               text    not null default 'unisex'
                            check (fit in ('unisex','mens','womens','youth')),
  position          integer not null,
  price_cents       integer             check (price_cents is null or price_cents > 0),
  barcode           text,
  weight_grams      integer,
  track_inventory   boolean not null default false,
  inventory_policy  text    not null default 'continue'
                            check (inventory_policy in ('continue','deny')),
  source_id         text,
  unique (product_id, size_code, fit),
  unique (product_id, position)
);

-- ---------------------------------------------------------------- media
-- Bytes live in object storage, never in Postgres. This table is metadata only.
-- storage_key is content-addressed, so re-importing the same file is a no-op
-- and the 6,614 archived blobs collapse onto the ~5,784 distinct images in use.

create table media (
  id          uuid        primary key default gen_random_uuid(),
  sha256      char(64)    not null unique,
  storage_key text        not null unique,   -- originals/<sha256>.<ext>
  mime        text        not null,
  width       integer,
  height      integer,
  bytes       bigint      not null check (bytes > 0),
  created_at  timestamptz not null default now()
);

create table product_media (
  product_id uuid    not null references products (id) on delete cascade,
  media_id   uuid    not null references media (id)    on delete restrict,
  position   integer not null,
  alt        text,
  primary key (product_id, media_id),
  unique (product_id, position)
);

-- ---------------------------------------------------------------- collections

create table collections (
  id         uuid    primary key default gen_random_uuid(),
  slug       text    not null unique,
  name       text    not null,
  kind       text    not null default 'merchandising'
                     check (kind in ('league','team','event','merchandising')),
  position   integer,
  source_id  text
);

create table collection_products (
  collection_id uuid    not null references collections (id) on delete cascade,
  product_id    uuid    not null references products (id)    on delete cascade,
  position      integer,
  primary key (collection_id, product_id)
);

-- ---------------------------------------------------------------- personalisation
-- Not populated by the import. Modelled now because it is the business case
-- (research.md §9.6) and retrofitting it into orders later is expensive.
-- Store the PARAMETERS as the record of truth; the rendered print file is a cache.

create table personalisation_options (
  id              uuid    primary key default gen_random_uuid(),
  product_id      uuid    not null references products (id) on delete cascade,
  kind            text    not null check (kind in ('name','number','patch')),
  price_cents     integer not null check (price_cents >= 0),
  max_length      integer,
  allowed_charset text,                       -- regex; jerseys are usually [A-Z .'-]
  required        boolean not null default false,
  unique (product_id, kind)
);

-- ---------------------------------------------------------------- jersey requests
-- "Can't find your jersey? Request it — we'll source it for you fast" is the store's
-- actual differentiator (research.md §12.1), so requests are a first-class object, not
-- a contact form. Every row is a customer telling you what to source next, with an
-- email attached — the only demand signal a competitor cannot copy.

create table jersey_requests (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null,
  raw_request   text        not null,          -- what they typed, kept verbatim
  -- parsed with the same vocabulary as the catalog, so the queue sorts by demand
  team          text,
  player        text,
  colourway     text,
  season        text,
  size_code     text,
  garment       text,
  source        text        not null default 'homepage'
                            check (source in ('homepage','product','search_empty','collection')),
  source_product_id uuid    references products (id) on delete set null,
  status        text        not null default 'new'
                            check (status in ('new','sourcing','quoted','fulfilled','declined')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index jersey_requests_status_idx on jersey_requests (status) where status = 'new';
-- what to stock next: group by team/player across open requests
create index jersey_requests_demand_idx on jersey_requests (team, player)
  where status in ('new', 'sourcing');
