import * as React from 'react'
import type { TemplateEntry } from './registry'
import { Cta, Layout, H, P, Small } from './layout'

interface Props { firmName?: string; inviterName?: string; role?: string; email?: string; link?: string }

const Email = ({ firmName, inviterName, role, email, link }: Props) => (
  <Layout preview={`Join ${firmName ?? 'your firm'} on FiledUnder`}>
    <H>Join {firmName ?? 'your firm'} on FiledUnder</H>
    <P>{inviterName ?? 'A colleague'} invited you to join {firmName ?? 'their firm'}{role ? ` as ${role.toLowerCase()}` : ''}.</P>
    <P>Sign in with {email ? <strong>{email}</strong> : 'this email address'} to accept. The invite expires after 14 days.</P>
    <Cta href={link ?? 'https://filedunder.ai/app'}>Accept the invite</Cta>
    <Small>If you weren't expecting this, you can ignore it.</Small>
  </Layout>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Join ${d.firmName ?? 'your firm'} on FiledUnder`,
  displayName: 'Firm invite',
  previewData: { firmName: 'Analytical Capital', inviterName: 'Grace', role: 'Member', email: 'ada@firm.com', link: 'https://filedunder.ai/app/join/abc' },
} satisfies TemplateEntry
