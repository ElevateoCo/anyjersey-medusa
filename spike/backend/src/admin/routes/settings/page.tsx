import { defineRouteConfig } from '@medusajs/admin-sdk'
import { CogSixTooth } from '@medusajs/icons'
import {
  Badge, Button, Container, Heading, Input, Prompt, Switch, Text, Textarea, toast,
} from '@medusajs/ui'
import { useCallback, useEffect, useState } from 'react'

/**
 * Every switch in the shop, grouped.
 *
 * The warning dialog is the feature, not the switch. Each of these has a consequence invisible
 * from in here until a customer complains — an order confirmation that stopped going out looks
 * exactly like one that is going out — so the dialog states the specific cost in the setting's
 * own words and, for the critical ones, asks the operator to type the name of what they are
 * switching off.
 *
 * Turning something back **on** asks nothing. Restoring the default should never be the harder
 * direction.
 */
export const config = defineRouteConfig({ label: 'Settings', icon: CogSixTooth })

type Setting = {
  key: string
  group: string
  label: string
  what: string
  consequence: string
  severity: 'safe' | 'serious' | 'critical'
  origin: string
  enabled: boolean
  disabled_at: string | null
  disabled_by: string | null
  reason: string | null
}
type Group = { group: string; title: string; blurb: string }
type Payload = {
  settings: Setting[]
  groups: Group[]
  disabled_count: number
  critical_disabled: string[]
}

const SEVERITY: Record<Setting['severity'], { label: string; color: 'red' | 'orange' | 'grey' }> = {
  critical: { label: 'critical', color: 'red' },
  serious: { label: 'serious', color: 'orange' },
  safe: { label: 'low risk', color: 'grey' },
}

export default function SettingsPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<Setting | null>(null)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/admin/settings', { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => toast.error('Could not load the settings'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const close = () => { setTarget(null); setReason(''); setTyped('') }

  const save = async (setting: Setting, enabled: boolean, why?: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/admin/settings/${setting.key}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, reason: why }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message ?? `Failed (${res.status})`)

      toast[enabled ? 'success' : 'warning'](
        `${setting.label} is ${enabled ? 'on' : 'off'}`,
        { description: enabled ? undefined : setting.consequence }
      )
      close()
      load()
    } catch (e) {
      toast.error('Not changed', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const onToggle = (setting: Setting, next: boolean) => {
    // On needs no confirmation. Off always does.
    if (next) return save(setting, true)
    setTarget(setting)
  }

  const needsTyping = target?.severity === 'critical'
  const canConfirm =
    !!reason.trim() &&
    (!needsTyping || typed.trim().toLowerCase() === (target?.label ?? '').toLowerCase())

  const inGroup = (group: string) => (data?.settings ?? []).filter((s) => s.group === group)

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Settings</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Switches that change what the shop does. Each one says what turning it off costs.
        </Text>
      </div>

      {!!data?.disabled_count && (
        <div className="px-6 py-3">
          <Badge color={data.critical_disabled.length ? 'red' : 'orange'}>
            {data.disabled_count} switched off
            {data.critical_disabled.length
              ? ` — including ${data.critical_disabled.length} critical` : ''}
          </Badge>
        </div>
      )}

      {loading && !data ? (
        <div className="px-6 py-8">
          <Text className="text-center text-ui-fg-subtle">Loading…</Text>
        </div>
      ) : (
        (data?.groups ?? []).map((group) => (
          <div key={group.group} className="px-6 py-4">
            <Heading level="h2">{group.title}</Heading>
            <Text size="small" className="mb-2 block text-ui-fg-subtle">{group.blurb}</Text>

            <div className="flex flex-col divide-y">
              {inGroup(group.group).map((s) => (
                <div key={s.key} className="flex items-start justify-between gap-6 py-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Text weight="plus">{s.label}</Text>
                      <Badge size="2xsmall" color={SEVERITY[s.severity].color}>
                        {SEVERITY[s.severity].label}
                      </Badge>
                    </div>
                    <Text size="small" className="mt-1 text-ui-fg-subtle">{s.what}</Text>
                    {!s.enabled && (
                      <Text size="small" className="mt-2 text-ui-fg-error">
                        Off since {s.disabled_at ? new Date(s.disabled_at).toLocaleString() : '—'}
                        {s.disabled_by ? ` · ${s.disabled_by}` : ''}
                        {s.reason ? ` · ${s.reason}` : ''}
                      </Text>
                    )}
                  </div>
                  <Switch
                    checked={s.enabled}
                    disabled={busy}
                    aria-label={`${s.label} enabled`}
                    onCheckedChange={(v) => onToggle(s, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <Prompt variant="danger" open={!!target} onOpenChange={(o) => !o && close()}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Switch off {target?.label}?</Prompt.Title>
            <Prompt.Description>{target?.consequence}</Prompt.Description>
          </Prompt.Header>

          <div className="flex flex-col gap-3 px-6 pb-2">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Why are you switching this off? Recorded with your name and the time.
              </Text>
              <Textarea rows={2} value={reason} disabled={busy}
                        placeholder="Migrating to a new provider this week"
                        onChange={(e) => setReason(e.target.value)} />
            </div>
            {needsTyping && (
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Type <strong>{target?.label}</strong> to confirm.
                </Text>
                <Input value={typed} disabled={busy}
                       onChange={(e) => setTyped(e.target.value)} />
              </div>
            )}
          </div>

          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            {/* Not Prompt.Action: that closes the dialog on click whatever happens, which
                would dismiss it before the confirmation had been checked. */}
            <Button variant="danger" disabled={!canConfirm || busy} isLoading={busy}
                    onClick={() => target && save(target, false, reason)}>
              Switch it off
            </Button>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </Container>
  )
}
