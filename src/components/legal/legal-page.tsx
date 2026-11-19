import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";

export const LEGAL_UPDATED = "November 19, 2026";

/** Shared layout for the public terms and privacy pages. */
export function LegalPage({ title, intro, sections }: { title: string; intro: ReactNode; sections: { h: string; body: ReactNode }[] }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 font-display text-xl">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-6 text-sm leading-relaxed text-muted-foreground">{intro}</div>
        <nav aria-label="Sections" className="mt-8 rounded-md border bg-card p-4">
          <ol className="grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.h}><a href={`#s${i + 1}`} className="hover:text-foreground hover:underline">{i + 1}. {s.h}</a></li>
            ))}
          </ol>
        </nav>
        {sections.map((s, i) => (
          <section key={s.h} id={`s${i + 1}`} className="mt-10 scroll-mt-24">
            <h2 className="text-base font-medium">{i + 1}. {s.h}</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_a]:text-foreground [&_a]:underline">{s.body}</div>
          </section>
        ))}
        <p className="mt-12 text-sm text-muted-foreground">Questions: <a className="text-foreground underline" href="mailto:admin@filedunder.ai">admin@filedunder.ai</a></p>
      </main>
      <SiteFooter />
    </div>
  );
}
