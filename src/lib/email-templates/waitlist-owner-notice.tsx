import * as React from 'react'
import type { TemplateEntry } from './registry'
import { Cta, Field, Layout, H, Small } from './layout'

interface Props { name?: string; email?: string; firm?: string; role?: string; useCase?: string; adminUrl?: string }

const Email = ({ name, email, firm, role, useCase, adminUrl }: Props) => (
  <Layout preview={`New waitlist signup: ${name ?? email ?? 'someone'}`}>
    <H>New waitlist signup</H>
    <Field label="Name" value={name} />
    <Field label="Work email" value={email} />
    <Field label="Firm" value={firm} />
    <Field label="Role" value={role} />
    <Field label="Wants to use it for" value={useCase} />
    <Cta href={adminUrl ?? 'https://filedunder.ai/app/admin'}>Open the waitlist</Cta>
    <Small>You get this because you're a FiledUnder admin.</Small>
  </Layout>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `New waitlist signup: ${d.name ?? d.email ?? 'someone'}`,
  displayName: 'Waitlist owner notice',
  previewData: { name: 'Ada Lovelace', email: 'ada@firm.com', firm: 'Analytical Capital', role: 'Analyst', useCase: 'Tracking segment KPIs', adminUrl: 'https://filedunder.ai/app/admin' },
} satisfies TemplateEntry
