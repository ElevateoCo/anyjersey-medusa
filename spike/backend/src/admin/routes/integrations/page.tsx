import { defineRouteConfig } from '@medusajs/admin-sdk'
import { CogSixTooth } from '@medusajs/icons'
import { Badge, Container, Heading, Table, Text } from '@medusajs/ui'
import { useEffect, useState } from 'react'

/**
 * What is wired up and what is still a placeholder.
 *
 * Exists because "is Stripe Tax on?" should be answerable without reading a .env over
 * somebody's shoulder — and because a key that is missing in production must be visible
 * rather than discovered when an order fails.
 */
type Integration = {
  key: string; name: string; purpose: string; docs: string
  criticalInProduction: boolean; configured: boolean; missing: string[]
}

export default function IntegrationsPage() {
  const [data, setData] = useState<{
    integrations: Integration[]
    summary: { total: number; configured: number; blocking_production: number }
  } | null>(null)

  useEffect(() => {
    fetch('/admin/integrations', { credentials: 'include' })
      .then((r) => r.json()).then(setData)
  }, [])

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Integrations</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          External services and their configuration state
        </Text>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-px bg-ui-border-base">
          {[
            { label: 'Configured', value: `${data.summary.configured} / ${data.summary.total}` },
            { label: 'Blocking production', value: String(data.summary.blocking_production) },
            { label: 'Optional, unset',
              value: String(data.summary.total - data.summary.configured - data.summary.blocking_production) },
          ].map((t) => (
            <div key={t.label} className="bg-ui-bg-base px-6 py-4">
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">
                {t.label}
              </Text>
              <Heading level="h2" className="tabular-nums mt-1">{t.value}</Heading>
            </div>
          ))}
        </div>
      )}

      <div className="px-6 py-4">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Service</Table.HeaderCell>
              <Table.HeaderCell>What it does</Table.HeaderCell>
              <Table.HeaderCell>State</Table.HeaderCell>
              <Table.HeaderCell>Missing variables</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(data?.integrations ?? []).map((i) => (
              <Table.Row key={i.key}>
                <Table.Cell>
                  <a href={i.docs} target="_blank" rel="noreferrer"
                     className="text-ui-fg-interactive">{i.name}</a>
                </Table.Cell>
                <Table.Cell className="max-w-sm">
                  <Text size="small" className="text-ui-fg-subtle">{i.purpose}</Text>
                </Table.Cell>
                <Table.Cell>
                  {i.configured
                    ? <Badge size="small" color="green">configured</Badge>
                    : i.criticalInProduction
                      ? <Badge size="small" color="red">blocks production</Badge>
                      : <Badge size="small" color="orange">optional</Badge>}
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="text-ui-fg-muted font-mono">
                    {i.missing.join(', ') || '—'}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>

      <div className="px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          Anything marked <em>blocks production</em> makes the app refuse to boot outside
          development. A silently disabled integration — no order confirmations, no tax
          calculation, no fraud screening — is worse than a container that will not start.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({ label: 'Integrations', icon: CogSixTooth })
