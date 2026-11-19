import * as React from 'react'
import type { TemplateEntry } from './registry'
import { Layout, H, P, Small } from './layout'

const Email = ({ name }: { name?: string }) => (
  <Layout preview="You're on the FiledUnder waitlist">
    <H>You're on the list</H>
    <P>{name ? `Hi ${name},` : 'Hi,'}</P>
    <P>Thanks for joining the FiledUnder waitlist. We open access to new analysts in small groups and review every request by hand.</P>
    <P>What happens next: we usually reply within a week. If you're approved, we'll email you a link to create your account with this address. Your 14-day trial starts only when you accept the terms after signing in.</P>
    <Small>You don't need to do anything now. If you didn't request this, you can ignore this email.</Small>
  </Layout>
)

export const template = {
  component: Email,
  subject: "You're on the FiledUnder waitlist",
  displayName: 'Waitlist receipt',
  previewData: { name: 'Ada' },
} satisfies TemplateEntry
