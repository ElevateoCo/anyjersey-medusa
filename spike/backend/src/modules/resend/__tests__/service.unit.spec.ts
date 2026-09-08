import ResendNotificationProviderService from '../service'

const logger = () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn(),
} as never)

const OPTS = { from: 'orders@example.test', apiKey: '' }

describe('Resend provider without an API key', () => {
  const original = process.env.NODE_ENV

  afterEach(() => { process.env.NODE_ENV = original })

  it('constructs in development and warns', () => {
    process.env.NODE_ENV = 'development'
    const log = logger()
    const svc = new ResendNotificationProviderService({ logger: log }, OPTS)
    expect(svc).toBeDefined()
    expect((log as unknown as { warn: jest.Mock }).warn).toHaveBeenCalled()
  })

  it('refuses to construct in production', () => {
    // Silently discarding order confirmations is worse than failing to boot.
    process.env.NODE_ENV = 'production'
    expect(() => new ResendNotificationProviderService({ logger: logger() }, OPTS)).toThrow(
      /RESEND_API_KEY is required/
    )
  })

  it('constructs under NODE_ENV=test', () => {
    // The first version of this guard checked `!== 'development'`, which threw during the
    // integration suite and blocked CI. A guard that blocks CI is a guard someone deletes,
    // so the rule is "fail closed in production" and this test pins it.
    process.env.NODE_ENV = 'test'
    expect(() => new ResendNotificationProviderService({ logger: logger() }, OPTS)).not.toThrow()
  })

  it('constructs under any other environment name', () => {
    for (const env of ['staging', 'ci', 'preview', undefined]) {
      process.env.NODE_ENV = env as string
      expect(() => new ResendNotificationProviderService({ logger: logger() }, OPTS)).not.toThrow()
    }
  })

  it('renders and reports success without calling the network', async () => {
    process.env.NODE_ENV = 'development'
    const svc = new ResendNotificationProviderService({ logger: logger() }, OPTS)
    const res = await svc.send({
      to: 'fan@example.com',
      channel: 'email',
      template: 'request-received',
      data: { raw_request: 'Kobe 2004 gold XL' },
    } as never)
    expect(res.id).toMatch(/^dry-run-/)
  })
})

describe('Resend provider validation', () => {
  beforeEach(() => { process.env.NODE_ENV = 'development' })

  it('requires a from address', () => {
    expect(() => ResendNotificationProviderService.validateOptions({})).toThrow(/from/)
    expect(() => ResendNotificationProviderService.validateOptions({ from: 'a@b.c' })).not.toThrow()
  })

  it('has a stable identifier', () => {
    expect(ResendNotificationProviderService.identifier).toBe('resend')
  })

  it('rejects an unknown template by name, listing the known ones', () => {
    const svc = new ResendNotificationProviderService({ logger: logger() }, OPTS)
    expect(() => svc.render('nope', {})).toThrow(/Unknown email template "nope"/)
    expect(() => svc.render('nope', {})).toThrow(/order-placed/)
  })

  it('throws when there is no recipient', async () => {
    const svc = new ResendNotificationProviderService({ logger: logger() }, OPTS)
    await expect(
      svc.send({ channel: 'email', template: 'request-received', data: {} } as never)
    ).rejects.toThrow(/No recipient/)
  })

  it('redirectTo overrides the recipient, for staging', async () => {
    const log = logger()
    const svc = new ResendNotificationProviderService(
      { logger: log }, { ...OPTS, redirectTo: 'staging@example.test' }
    )
    await svc.send({
      to: 'real-customer@example.com', channel: 'email',
      template: 'request-received', data: { raw_request: 'x' },
    } as never)
    const logged = (log as unknown as { info: jest.Mock }).info.mock.calls.flat().join('\n')
    expect(logged).toContain('staging@example.test')
    expect(logged).not.toContain('real-customer@example.com')
  })
})
