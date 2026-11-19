import * as React from 'react'
import type { TemplateEntry } from './registry'
import { Cta, Layout, H, P, Small } from './layout'

interface Props { name?: string; email?: string; link?: string }

const Email = ({ name, email, link }: Props) => (
  <Layout preview="Your FiledUnder access is ready when you are">
    <H>Your access is ready when you are</H>
    <P>{name ? `Hi ${name},` : 'Hi,'}</P>
    <P>You were approved for FiledUnder a few days ago and haven't signed in yet. Use {email ? <strong>{email}</strong> : 'this email address'} to get started.</P>
    <Cta href={link ?? 'https://filedunder.ai/auth'}>Sign in to FiledUnder</Cta>
    <Small>This is the only reminder we'll send. Your 14-day trial hasn't started; it starts when you accept the terms.</Small>
  </Layout>
)

export const template = {
  component: Email,
  subject: 'Your FiledUnder access is ready',
  displayName: 'Waitlist reminder',
  previewData: { name: 'Ada', email: 'ada@firm.com', link: 'https://filedunder.ai/auth?mode=signin&email=ada%40firm.com&redirect=%2Fapp' },
} satisfies TemplateEntry
