import { jsonLdString, type JsonLdValue } from '@/lib/seo'

/**
 * A structured-data block.
 *
 * `dangerouslySetInnerHTML` is correct here and the escaping in `jsonLdString` is what
 * makes it correct: React would otherwise HTML-escape the JSON and produce a document
 * that no parser accepts. Product titles and descriptions are catalog data, so the `<`
 * and `>` escaping is not theoretical.
 *
 * `type="application/ld+json"` is not executable, so the CSP `script-src` allow-list does
 * not apply to it — worth knowing before adding it there and widening the PCI surface for
 * no reason (research.md §7.5).
 */
export default function JsonLd({ data }: { data: JsonLdValue | JsonLdValue[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdString(data) }}
    />
  )
}
