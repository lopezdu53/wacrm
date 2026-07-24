import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Self-contained shell for the public legal pages (Privacy, Terms, Data
 * deletion). These are linked from Meta's App Dashboard, so they must be
 * readable for reviewers regardless of the app's dark/light theme —
 * hence the explicit light styling rather than theme tokens.
 */
export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <header className="mb-8 border-b border-slate-200 pb-6">
          <Link
            href="/"
            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
          >
            wacrm
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Última actualización: {lastUpdated}
          </p>
        </header>

        <article className="space-y-6 text-[15px] leading-relaxed [&_a]:text-emerald-700 [&_a]:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-slate-900 [&_li]:ml-1 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
          {children}
        </article>

        <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy">Política de Privacidad</Link>
            <Link href="/terms">Condiciones del Servicio</Link>
            <Link href="/data-deletion">Eliminación de datos</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
