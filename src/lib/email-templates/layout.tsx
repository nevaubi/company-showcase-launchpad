import * as React from 'react'
import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'

// Paper palette: ink on warm paper with one highlight accent. Body stays white for mail clients.
export const C = { ink: '#1f232b', muted: '#5f636b', paper: '#faf7f0', rule: '#e6e0d2', accent: '#d9622b' }

export const Layout = ({ preview, children }: { preview: string; children: React.ReactNode }) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{preview}</Preview>
    <Body style={{ backgroundColor: '#ffffff', margin: 0, padding: '24px 0', fontFamily: 'Georgia, "Times New Roman", serif' }}>
      <Container style={{ backgroundColor: C.paper, border: `1px solid ${C.rule}`, maxWidth: '560px', padding: '32px 36px' }}>
        <Text style={{ margin: 0, fontSize: '20px', color: C.ink, letterSpacing: '0.2px' }}>
          FiledUnder<span style={{ color: C.accent }}>.</span>
        </Text>
        <Hr style={{ borderColor: C.accent, borderWidth: '2px 0 0', width: '36px', margin: '8px 0 24px' }} />
        {children}
        <Hr style={{ borderColor: C.rule, margin: '28px 0 12px' }} />
        <Text style={{ margin: 0, fontSize: '12px', color: C.muted, fontFamily: 'Arial, sans-serif' }}>
          FiledUnder, US equity research where every number links to its SEC source.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const H = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ margin: '0 0 16px', fontSize: '20px', lineHeight: '28px', color: C.ink }}>{children}</Text>
)
export const P = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ margin: '0 0 14px', fontSize: '14px', lineHeight: '22px', color: C.ink, fontFamily: 'Arial, sans-serif' }}>{children}</Text>
)
export const Small = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ margin: '0 0 10px', fontSize: '13px', lineHeight: '20px', color: C.muted, fontFamily: 'Arial, sans-serif' }}>{children}</Text>
)
export const Cta = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Section style={{ margin: '8px 0 18px' }}>
    <Link href={href} style={{ display: 'inline-block', backgroundColor: C.ink, color: C.paper, padding: '11px 18px', fontSize: '14px', fontFamily: 'Arial, sans-serif', textDecoration: 'none' }}>
      {children}
    </Link>
  </Section>
)
export const Field = ({ label, value }: { label: string; value?: string | null }) => (
  <Text style={{ margin: '0 0 6px', fontSize: '14px', lineHeight: '20px', color: C.ink, fontFamily: 'Arial, sans-serif' }}>
    <span style={{ color: C.muted }}>{label}: </span>{value || 'Not given'}
  </Text>
)
