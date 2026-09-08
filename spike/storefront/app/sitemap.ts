import type { MetadataRoute } from 'next'
import { getCollections, getSitemapIndex } from '@/lib/medusa'
import { INDEXABLE, abs } from '@/lib/site'
import { CONTENT_PAGES, LEGAL_PAGES } from '@/lib/content'
import { POLICIES } from '@/lib/policies'

export const revalidate = 3600

/**
 * sitemap.xml
 *
 * Built from `/store/sitemap`, a backend route that returns handles and `updated_at` in
 * one query. The obvious alternative — walking `/store/jerseys` — caps `limit` at 100, so
 * a 3,155-product sitemap would be 32 round trips on every rebuild.
 *
 * `lastModified` is the product's real `updated_at`, not the build time. A sitemap that
 * claims every page changed at deploy is a sitemap a crawler learns to ignore, and it
 * throws away the one signal the file is actually good at carrying.
 *
 * Empty when the environment is not indexable, for the same reason robots.txt closes: a
 * staging sitemap advertising staging URLs is a live problem, not a harmless artefact.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!INDEXABLE) return []

  const [index, collections] = await Promise.all([getSitemapIndex(), getCollections()])
  const now = new Date()

  const entries: MetadataRoute.Sitemap = [
    { url: abs('/'), lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: abs('/jerseys'), lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: abs('/request'), lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    // Its own product line, with its own copy and canonical — see generateMetadata on the
    // listing page. Ranked high because it is the thing nobody else sells.
    { url: abs('/jerseys?custom=true'), lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
  ]

  // Content and policy pages. Low priority, but they must be crawlable: a returns policy
  // that only exists behind a footer link is one a customer cannot find before buying,
  // which is the point of publishing it.
  for (const c of CONTENT_PAGES) {
    entries.push({
      url: abs(c.path), lastModified: now, changeFrequency: 'monthly', priority: 0.5,
    })
  }
  for (const c of LEGAL_PAGES) {
    entries.push({
      url: abs(c.path), lastModified: now, changeFrequency: 'yearly', priority: 0.3,
    })
  }
  for (const p of POLICIES) {
    entries.push({
      url: abs(`/policies/${p.slug}`), lastModified: now,
      changeFrequency: 'yearly', priority: 0.3,
    })
  }

  // Curated collections. Ranked above facet views because they are pages somebody wrote,
  // and they carry copy a filtered listing does not.
  for (const c of collections) {
    entries.push({
      url: abs(`/collections/${c.handle}`),
      lastModified: now, changeFrequency: 'daily', priority: 0.8,
    })
  }

  // Single-facet listing views. These are the only filter URLs `generateMetadata` marks
  // indexable, so they are the only ones that belong here — a sitemap listing a noindex
  // page is a contradiction a crawler resolves against you.
  for (const league of index.leagues) {
    entries.push({
      url: abs(`/jerseys?league=${encodeURIComponent(league)}`),
      lastModified: now, changeFrequency: 'weekly', priority: 0.8,
    })
  }
  for (const team of index.teams) {
    entries.push({
      url: abs(`/jerseys?team=${encodeURIComponent(team)}`),
      lastModified: now, changeFrequency: 'weekly', priority: 0.7,
    })
  }

  for (const p of index.products) {
    entries.push({
      url: abs(`/jerseys/${p.handle}`),
      lastModified: new Date(p.updated_at),
      changeFrequency: 'weekly',
      priority: 0.6,
    })
  }

  return entries
}
