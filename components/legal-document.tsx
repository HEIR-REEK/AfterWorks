import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { BrandLockup } from '@/components/brand'
import { TERMS_CONTACT, TERMS_EFFECTIVE, TERMS_ENTITY, TERMS_VERSION, type TermsSection } from '@/lib/terms'

/**
 * Shared layout for `/terms` and `/privacy`.
 *
 * One component for both documents, because they are two views of the same content module and a
 * copy-pasted layout is how the two start disagreeing about what the sign-up checkbox actually
 * promised. The version and effective date come from `lib/terms` too, so the acceptance record
 * written at sign-up names exactly the text on this page.
 */
export function LegalDocument({
  title,
  intro,
  sections,
  version,
}: {
  title: string
  intro: string
  sections: readonly TermsSection[]
  version?: string
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6">
          <Link href="/sign-up" className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" />
            Back to sign up
          </Link>
          <BrandLockup width={120} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{intro}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {version ? `Version ${version} · ` : ''}Effective {TERMS_EFFECTIVE} · {TERMS_ENTITY}
        </p>

        <nav className="mt-8 rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p>
          <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 flex flex-col gap-10">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 40)} className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
                  {section.bullets.map((bullet) => (
                    <li key={bullet.slice(0, 40)}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-sm">
          <p className="font-medium">Questions about this document?</p>
          <p className="text-muted-foreground">
            Write to{' '}
            <a href={`mailto:${TERMS_CONTACT}`} className="font-medium text-primary hover:underline">
              {TERMS_CONTACT}
            </a>
            . We aim to respond within 14 days.
          </p>
          <p className="text-xs text-muted-foreground">
            Terms version {version ?? TERMS_VERSION} — the version recorded against your account when you accepted it.
          </p>
        </div>
      </main>
    </div>
  )
}
