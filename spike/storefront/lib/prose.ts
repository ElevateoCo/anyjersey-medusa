/**
 * The block vocabulary for written pages.
 *
 * Policy and help pages are content, not components. Keeping them as data has one concrete
 * benefit that justifies the indirection: the renderer can enumerate what a page is
 * *missing*. A `pending` block names the entity fields a section depends on, so a privacy
 * policy with no Article 27 representative appointed says so on the page instead of quietly
 * omitting a disclosure the law requires (research.md §7.6).
 *
 * It also means every page gets the same heading levels, the same table markup and the same
 * skip-target behaviour, which is most of what the accessibility pass was fixing by hand.
 */
export type Block =
  | { p: string }
  | { ul: string[] }
  | { ol: string[] }
  /** Definition-style rows. Rendered as a real <table> with row headers. */
  | { rows: [string, string][] }
  /** Names entity fields from lib/site.ts that this section cannot state without. */
  | { pending: string[] }
  /** A boxed aside. `tone: 'warn'` for something the reader must not miss. */
  | { note: string; tone?: 'warn' }

export type Section = { title: string; blocks: Block[] }

export type Doc = {
  slug: string
  title: string
  /** One sentence, used as the meta description and as the page standfirst. */
  summary: string
  /**
   * Whether this document makes legally operative statements. Those carry a review
   * banner: an unreviewed refund policy is a contract term, and publishing a draft as if
   * it were settled is the failure mode §7.10 is about.
   */
  legal?: boolean
  updated: string
  sections: Section[]
}
