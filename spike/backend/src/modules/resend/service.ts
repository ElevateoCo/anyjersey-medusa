import { AbstractNotificationProviderService, MedusaError } from '@medusajs/framework/utils'
import type {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
  Logger,
} from '@medusajs/framework/types'
import { Resend } from 'resend'
import { TEMPLATES, type Rendered, type TemplateKey } from './templates'

export type ResendOptions = {
  apiKey?: string
  from?: string
  replyTo?: string
  /** Route every message here instead of the real recipient. For staging. */
  redirectTo?: string
}

type Injected = { logger: Logger }

/**
 * Resend notification provider.
 *
 * Deliberately safe without credentials: when RESEND_API_KEY is absent the provider
 * renders the email, logs a summary, and reports success without calling the network.
 * That keeps the spike runnable and, more usefully, means a missing key in staging
 * produces a visible log line rather than a crashed checkout.
 *
 * It refuses to be silent in production, though — see the constructor.
 */
class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = 'resend'

  protected readonly options_: ResendOptions
  protected readonly logger_: Logger
  protected readonly client_: Resend | null

  constructor({ logger }: Injected, options: ResendOptions) {
    super()
    this.options_ = options
    this.logger_ = logger

    if (!options.apiKey) {
      // A missing key is acceptable anywhere except production: silently dropping order
      // confirmations is worse than failing to boot. Checked as `=== 'production'` rather
      // than `!== 'development'` so the integration suite (NODE_ENV=test) can run.
      if ((process.env.NODE_ENV ?? 'development') === 'production') {
        throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          'RESEND_API_KEY is required outside development — otherwise order ' +
          'confirmations are silently discarded.'
        )
      }
      this.client_ = null
      logger.warn(
        '  ! RESEND_API_KEY not set — emails will be rendered and logged, not sent.'
      )
    } else {
      this.client_ = new Resend(options.apiKey)
    }
  }

  static validateOptions(options: Record<string, unknown>) {
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        'Resend provider requires a `from` address.'
      )
    }
  }

  /** Renders a template by key. Exposed so it can be unit tested without a client. */
  render(template: string, data: Record<string, unknown>): Rendered {
    const fn = TEMPLATES[template as TemplateKey]
    if (!fn) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown email template "${template}". Known: ${Object.keys(TEMPLATES).join(', ')}`
      )
    }
    return (fn as (d: unknown) => Rendered)(data)
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const to = this.options_.redirectTo || notification.to
    if (!to) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, 'No recipient for notification')
    }

    const { subject, html, text, headers } = this.render(
      notification.template,
      (notification.data ?? {}) as Record<string, unknown>
    )

    if (!this.client_) {
      this.logger_.info(
        [
          '',
          '  ┌─ EMAIL (not sent — no RESEND_API_KEY) ──────────────────',
          `  │ to       ${to}`,
          `  │ from     ${this.options_.from}`,
          `  │ template ${notification.template}`,
          `  │ subject  ${subject}`,
          `  │ text     ${text.split('\n').slice(0, 4).join(' / ').slice(0, 90)}…`,
          '  └─────────────────────────────────────────────────────────',
          '',
        ].join('\n')
      )
      return { id: `dry-run-${Date.now()}` }
    }

    try {
      const { data, error } = await this.client_.emails.send({
        from: this.options_.from!,
        to: [to],
        replyTo: this.options_.replyTo,
        subject,
        html,
        text,
        // Only the commercial message sets any. See the note on `Rendered`.
        ...(headers ? { headers } : {}),
      })
      if (error) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Resend: ${error.message}`)
      }
      this.logger_.info(`email sent: ${notification.template} -> ${to} (${data?.id})`)
      return { id: data?.id ?? '' }
    } catch (e) {
      // Never let a failed email roll back an order. Log loudly, report the failure, and
      // let the retry live in the queue rather than in the checkout request.
      this.logger_.error(
        `email FAILED: ${notification.template} -> ${to}: ${
          e instanceof Error ? e.message : String(e)}`
      )
      throw e
    }
  }
}

export default ResendNotificationProviderService
