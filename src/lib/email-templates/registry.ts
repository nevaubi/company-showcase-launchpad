import type { ComponentType } from 'react'
import { template as receipt } from './waitlist-receipt'
import { template as ownerNotice } from './waitlist-owner-notice'
import { template as approved } from './waitlist-approved'
import { template as reminder } from './waitlist-reminder'
import { template as firmInvite } from './firm-invite'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'waitlist-receipt': receipt,
  'waitlist-owner-notice': ownerNotice,
  'waitlist-approved': approved,
  'waitlist-reminder': reminder,
  'firm-invite': firmInvite,
}
