import * as React from 'react'
import type { TemplateEntry } from './registry'
import { Cta, Layout, H, P, Small } from './layout'

interface Props { name?: string; email?: string; link?: string; hasAccount?: boolean }

const Email = ({ name, email, link, hasAccount }: Props) => (
  <Layout preview="Your FiledUnder access is approved">
    <H>Your access is approved</H>
    <P>{name ? `Hi ${name},` : 'Hi,'}</P>
    <P>
      You can now use FiledUnder. {hasAccount ? 'Sign in' : 'Create your account'} with {email ? <strong>{email}</strong> : 'this email address'}; approval is tied to that address.
    </P>
    <Cta href={link ?? 'https://filedunder.ai/auth'}>{hasAccount ? 'Sign in' : 'Create your account'}</Cta>
    <P>After you sign in, you'll be asked to accept the terms. Your 14-day trial starts only once you accept.</P>
    <Small>If the button doesn't work, paste this link into your browser: {link ?? 'https://filedunder.ai/auth'}</Small>
  </Layout>
)

export const template = {
  component: Email,
  subject: 'Your FiledUnder access is approved',
  displayName: 'Waitlist approval',
  previewData: { name: 'Ada', email: 'ada@firm.com', hasAccount: false, link: 'https://filedunder.ai/auth?mode=signup&email=ada%40firm.com&redirect=%2Fapp' },
} satisfies TemplateEntry
