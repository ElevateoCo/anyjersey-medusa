'use client'
import { useActionState } from 'react'

/**
 * The shared shell for the four auth forms.
 *
 * `useActionState` keeps the server action's result on screen without losing what was typed,
 * which is the whole requirement: every failure on these forms is expected (wrong password,
 * email taken, mismatched confirmation) and re-rendering an empty form is the worst possible
 * response to a typo.
 *
 * The message is in a `role="alert"` region so a screen reader hears it without the focus
 * having to move — a validation message that only appears visually is a form that cannot be
 * completed without sight.
 */
export type ActionResult = { ok: boolean; message?: string }

export default function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  footer,
}: {
  action: (state: ActionResult | null, form: FormData) => Promise<ActionResult>
  submitLabel: string
  pendingLabel: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, null)

  return (
    <form action={formAction} className="cform">
      {state?.message && (
        <p
          className={state.ok ? 'callout' : 'rmsg err'}
          role="alert"
          style={state.ok ? undefined : { color: '#B3261E' }}
        >
          {state.message}
        </p>
      )}
      {children}
      <button className="btn block" type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
      {footer}
    </form>
  )
}
