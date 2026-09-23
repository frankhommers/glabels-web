/** Access to the translation layer. */

import { useEffect, type ReactNode } from 'react'
import { I18nProvider, useI18n, type Catalog, type LooseTranslate, type Translator } from './core'
import { en, type Messages } from './en'
import { nl } from './nl'

export { useI18n } from './core'
export type { LooseTranslate, Vars } from './core'

/** Every key in the English source catalogue, and no other. */
export type MessageKey = keyof Messages

/** The translate function as components use it. */
export type Translate = Translator<MessageKey>

const CATALOGS: Record<string, Catalog> = { en, nl }

/** Shortest form for components: `const t = useT()`. */
export function useT(): Translate {
  return useI18n().t as Translate
}

/** For keys that are only known at run time, such as an error code from the
 *  server. A key that does not exist gives `undefined`. */
export function useLooseT(): LooseTranslate {
  return useI18n().loose
}

/** Which interface language belongs to a region setting?
 *
 *  The region also decides the interface language: `nl-BE` gives Dutch,
 *  everything else English. With nothing set, the browser decides.
 */
export function languageFor(locale: string | undefined): string {
  const source = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en')
  const base = source.split('-')[0].toLowerCase()
  return base in CATALOGS ? base : 'en'
}

export function TranslationProvider({
  locale,
  children,
}: {
  locale: string | undefined
  children: ReactNode
}) {
  const language = languageFor(locale)
  // Screen readers and the browser's hyphenation follow the page language.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  return (
    <I18nProvider language={language} locale={locale} catalogs={CATALOGS} fallback={en}>
      {children}
    </I18nProvider>
  )
}
