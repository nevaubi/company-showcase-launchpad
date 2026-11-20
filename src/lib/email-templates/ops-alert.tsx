import * as React from 'react'
import type { TemplateEntry } from './registry'
import { Cta, Layout, H, P, Small } from './layout'

interface AlertItem { key: string; title: string; since: string; tried: string; action: string }
interface Props { subject?: string; alerts?: AlertItem[]; link?: string }

const when = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : iso
}

/** Owner alert from the watchdog: what is wrong, since when, what already happens, what to do. */
const Email = ({ alerts = [], link }: Props) => (
  <Layout preview={alerts.length === 1 ? alerts[0].title : `${alerts.length} data pipeline problems`}>
    <H>{alerts.length === 1 ? 'A data pipeline needs a look' : `${alerts.length} data pipeline problems need a look`}</H>
    {alerts.map((a) => (
      <React.Fragment key={a.key}>
        <P><strong>{a.title}</strong></P>
        <Small>Since {when(a.since)}. Already happening: {a.tried}.</Small>
        <P>To do: {a.action}</P>
      </React.Fragment>
    ))}
    <Cta href={link ?? 'https://filedunder.ai/app/freshness'}>Open the freshness page</Cta>
    <Small>You get one email per problem. It is sent again only if the problem clears and comes back.</Small>
  </Layout>
)

export const template = {
  component: Email,
  subject: (d: Record<string, unknown>) => (typeof d.subject === 'string' ? d.subject : 'FiledUnder ops alert'),
  displayName: 'Ops alert',
  previewData: {
    subject: 'FiledUnder ops: 2 problems need a look',
    link: 'https://filedunder.ai/app/freshness',
    alerts: [
      { key: 'worker-heartbeat', title: 'Render worker silent: last heartbeat 34 min ago', since: '2026-11-20T08:10:00Z', tried: 'worker-start restarts the loop by itself after a crash', action: 'Open the Render dashboard for the worker service and restart it.' },
      { key: 'options-blocked', title: 'Options collection blocked: Cboe refused option chains (403 x4, 429 x0)', since: '2026-11-19T22:20:00Z', tried: 'the job holds its place and backs off from 2 to 60 minutes between tries', action: 'Check whether Cboe blocks the app host.' },
    ],
  },
} satisfies TemplateEntry
