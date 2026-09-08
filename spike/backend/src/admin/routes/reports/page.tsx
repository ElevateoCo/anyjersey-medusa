import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ChartBar } from '@medusajs/icons'
import { Container, Heading, Select, Table, Text } from '@medusajs/ui'
import { useEffect, useState } from 'react'
import BarChart, { RankedBars } from '../../components/bar-chart'

/**
 * The gap §15.3 calls the big one: Medusa ships no merchant-facing reporting.
 *
 * Headline figures are stat tiles rather than charts — a single number does not need a
 * plot. The daily series is a bar chart because daily counts are discrete periods. The
 * breakdowns are ranked horizontal bars, direct-labelled.
 *
 * Revenue by league, team and colourway only exists because the taxonomy was derived in
 * §13.3. The same report on the live Shopify store would be blank: those fields are
 * populated on ~60 of 3,636 products there.
 */
type Bucket = { key: string; orders: number; revenue: number; units: number }
type Overview = {
  period: { days: number }
  totals: {
    orders: number; revenue: number; units: number; aov: number
    shipping: number; tax: number; currency: string
  }
  series: Bucket[]
  top_products: Bucket[]
  by_league: Bucket[]
  by_team: Bucket[]
  by_colourway: Bucket[]
  by_region: Bucket[]
  demand: { key: string; count: number }[]
  _notes: { conversion: string; performance: string }
}

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
]

export default function ReportsPage() {
  const [days, setDays] = useState('30')
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/admin/reports/overview?days=${days}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [days])

  const cur = data?.totals.currency ?? 'USD'
  const money = (n: number) =>
    `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`
  const plain = (n: number) => n.toLocaleString()

  const tiles = data ? [
    { label: 'Revenue', value: money(data.totals.revenue) },
    { label: 'Orders', value: plain(data.totals.orders) },
    { label: 'Average order value', value: money(data.totals.aov) },
    { label: 'Units', value: plain(data.totals.units) },
    { label: 'Shipping collected', value: money(data.totals.shipping) },
    { label: 'Tax collected', value: money(data.totals.tax) },
  ] : []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Reports</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Revenue, orders and what to source next
          </Text>
        </div>
        <Select value={days} onValueChange={setDays}>
          <Select.Trigger className="w-48"><Select.Value /></Select.Trigger>
          <Select.Content>
            {RANGES.map((r) => (
              <Select.Item key={r.value} value={r.value}>{r.label}</Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      {loading || !data ? (
        <div className="px-6 py-8">
          <Text size="small" className="text-ui-fg-muted">Loading…</Text>
        </div>
      ) : (
        <>
          {/* Headline figures: stat tiles, not charts */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-ui-border-base">
            {tiles.map((t) => (
              <div key={t.label} className="bg-ui-bg-base px-6 py-4">
                <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">
                  {t.label}
                </Text>
                <Heading level="h2" className="tabular-nums mt-1">{t.value}</Heading>
              </div>
            ))}
          </div>

          <div className="px-6 py-5">
            <div className="flex items-baseline justify-between mb-3">
              <Heading level="h3">Orders per day</Heading>
              <button className="text-ui-fg-interactive txt-small"
                      onClick={() => setShowTable((v) => !v)}>
                {showTable ? 'Hide table' : 'View as table'}
              </button>
            </div>
            <BarChart
              points={data.series.map((s) => ({ key: s.key, value: s.orders, label: s.key }))}
              format={plain}
              emptyNote="No orders in this period"
            />
            {showTable && (
              <div className="mt-4 max-h-64 overflow-y-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Day</Table.HeaderCell>
                      <Table.HeaderCell>Orders</Table.HeaderCell>
                      <Table.HeaderCell>Revenue</Table.HeaderCell>
                      <Table.HeaderCell>Units</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.series.filter((s) => s.orders > 0).reverse().map((s) => (
                      <Table.Row key={s.key}>
                        <Table.Cell>{s.key}</Table.Cell>
                        <Table.Cell className="tabular-nums">{s.orders}</Table.Cell>
                        <Table.Cell className="tabular-nums">{money(s.revenue)}</Table.Cell>
                        <Table.Cell className="tabular-nums">{s.units}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </div>

          <div className="px-6 py-5">
            <Heading level="h3" className="mb-1">Revenue by league</Heading>
            <Text size="small" className="text-ui-fg-subtle mb-3">
              Only possible because the taxonomy was derived from titles — these fields are
              empty on the source catalog.
            </Text>
            <RankedBars
              rows={data.by_league.map((b) => ({
                key: b.key, value: b.revenue, sub: `${b.units} units`,
              }))}
              format={money}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-px bg-ui-border-base">
            <div className="bg-ui-bg-base px-6 py-5">
              <Heading level="h3" className="mb-3">Top teams</Heading>
              <RankedBars rows={data.by_team.slice(0, 8).map((b) => ({
                key: b.key, value: b.revenue,
              }))} format={money} />
            </div>
            <div className="bg-ui-bg-base px-6 py-5">
              <Heading level="h3" className="mb-3">Colourways</Heading>
              <RankedBars rows={data.by_colourway.slice(0, 8).map((b) => ({
                key: b.key, value: b.revenue,
              }))} format={money} />
            </div>
          </div>

          <div className="px-6 py-5">
            <Heading level="h3" className="mb-3">Top products</Heading>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Product</Table.HeaderCell>
                  <Table.HeaderCell>Units</Table.HeaderCell>
                  <Table.HeaderCell>Revenue</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.top_products.map((p) => (
                  <Table.Row key={p.key}>
                    <Table.Cell className="max-w-md truncate">{p.key}</Table.Cell>
                    <Table.Cell className="tabular-nums">{p.units}</Table.Cell>
                    <Table.Cell className="tabular-nums">{money(p.revenue)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>

          {data.demand.length > 0 && (
            <div className="px-6 py-5">
              <Heading level="h3" className="mb-1">Source these next</Heading>
              <Text size="small" className="text-ui-fg-subtle mb-3">
                Open requests, ranked by how many people asked. No conventional store can
                show this — the mechanic does not exist there.
              </Text>
              <RankedBars rows={data.demand.map((d) => ({ key: d.key, value: d.count }))}
                          format={(n) => `${n} asked`} />
            </div>
          )}

          <div className="px-6 py-4">
            <Text size="xsmall" className="text-ui-fg-muted">
              {data._notes.conversion} {data._notes.performance}
            </Text>
          </div>
        </>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({ label: 'Reports', icon: ChartBar })
