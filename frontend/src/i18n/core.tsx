/** Translation layer.
 *
 *  The English catalogue is the source: other languages are typed against
 *  it, so a missing or stray key is a compile error rather than a hole in the
 *  interface. The key is typed on the other side too — `useT()` in
 *  `index.tsx` only accepts keys that exist.
 *
 *  A message may contain placeholders (`{name}`) and can have a plural form;
 *  which form is needed is decided by `Intl.PluralRules` for the chosen
 *  language.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'

export type Plural = { one: string; other: string }
export type Message = string | Plural
export type Catalog = Record<string, Message>
export type Vars = Record<string, string | number>

/** Translator for the keys of a catalogue; `index.tsx` fills in `K`. */
export type Translator<K extends string = string> = (key: K, vars?: Vars) => string

/** Translator for a key that is only known at run time, such as an error
 *  code from the server. An unknown key gives `undefined`. */
export type LooseTranslate = (key: string, vars?: Vars) => string | undefined

type Context = {
  t: Translator
  loose: LooseTranslate
  language: string
  locale: string | undefined
}

const I18nContext = createContext<Context | null>(null)

function fill(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

function createBoth(
  catalog: Catalog,
  fallback: Catalog,
  locale: string | undefined,
): { t: Translator; loose: LooseTranslate } {
  const rules = new Intl.PluralRules(locale)

  const render = (message: Message, vars?: Vars): string => {
    if (typeof message === 'string') return fill(message, vars)
    const count = Number(vars?.count ?? 0)
    const form = rules.select(count)
    return fill(form === 'one' ? message.one : message.other, vars)
  }

  const loose: LooseTranslate = (key, vars) => {
    const message = catalog[key] ?? fallback[key]
    return message === undefined ? undefined : render(message, vars)
  }

  const t: Translator = (key, vars) => {
    const text = loose(key, vars)
    if (text === undefined) {
      // Make it visible instead of silently leaving a gap.
      if (import.meta.env.DEV) console.warn(`missing translation: ${key}`)
      return key
    }
    return text
  }

  return { t, loose }
}

export function createTranslator(
  catalog: Catalog,
  fallback: Catalog,
  locale: string | undefined,
): Translator {
  return createBoth(catalog, fallback, locale).t
}

export function I18nProvider({
  language,
  locale,
  catalogs,
  fallback,
  children,
}: {
  language: string
  locale: string | undefined
  catalogs: Record<string, Catalog>
  fallback: Catalog
  children: ReactNode
}) {
  const value = useMemo<Context>(() => {
    const catalog = catalogs[language] ?? fallback
    return { ...createBoth(catalog, fallback, locale), language, locale }
  }, [language, locale, catalogs, fallback])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): Context {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
