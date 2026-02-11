#!/usr/bin/env bun

import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Constants — single source of truth for scope names and paths
// ---------------------------------------------------------------------------

const ROOT_DIR = join(__dirname, '..')
const LANGUAGES_FILE = join(ROOT_DIR, 'scripts', 'languages.json')
const PACKAGE_JSON_FILE = join(ROOT_DIR, 'package.json')
const GENERATED_DIR = join(ROOT_DIR, 'syntaxes', 'generated')

const JIG_HTML_SCOPE = 'source.jig.html'
const EMBEDDED_GRAMMAR_SCOPE = 'source.jig.embedded.language'
const EMBED_GRAMMAR_SCOPE = 'meta.embedded.jig-languages'
const FENCED_CODE_BLOCK_SCOPE = 'embedded.jig.codeblock'

/** The pure Jig language — no host grammar, just Jig syntax + embed blocks.
 * Reuses `source.jig` (syntaxes/jig.tmLanguage.json) directly. */
const PURE_JIG_LANG = {
  id: 'jig',
  scopeName: 'source.jig',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LanguageConfig {
  id: string
  aliases: string[]
  extensions: string[]
  hostLanguageScope: string
  vscodeLangId?: string
  overrideAliases?: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(filePath: string): any {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err: any) {
    console.error(`Failed to read ${filePath}: ${err.message}`)
    process.exit(1)
  }
  try {
    return JSON.parse(raw)
  } catch (err: any) {
    console.error(`Failed to parse ${filePath} as JSON: ${err.message}`)
    process.exit(1)
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildLanguageAlternation(lang: LanguageConfig): string {
  const shortName = lang.id.replace('jig-', '')
  const names = [shortName, ...(lang.overrideAliases ?? [])]
  const escaped = names.map(escapeRegex)
  return `(?i:${escaped.join('|')})`
}

function resolveVscodeLangId(lang: LanguageConfig): string {
  const shortName = lang.id.replace('jig-', '')
  return lang.vscodeLangId ?? shortName
}

function getShortName(lang: LanguageConfig): string {
  return lang.id.replace('jig-', '')
}

function getScopeKey(lang: LanguageConfig): string {
  return getShortName(lang).replace(/-/g, '_')
}

function getPerLanguageScopeName(lang: LanguageConfig): string {
  return `text.jig.${getShortName(lang)}`
}

// ---------------------------------------------------------------------------
// Per-language grammar generation
// ---------------------------------------------------------------------------

/**
 * Generate a per-language jig-<lang>.tmLanguage.json grammar.
 *
 * Structure:
 *   1. { "include": "meta.embedded.jig-languages" } — cross-language embed blocks
 *   2. { "include": "source.jig" } — Jig patterns (tags, mustache, comments)
 *   3. { "include": "<hostLanguageScope>" } — host language highlighting
 */
function generatePerLanguageGrammar(lang: LanguageConfig): object {
  const shortName = getShortName(lang)
  const scopeName = getPerLanguageScopeName(lang)

  return {
    name: `jig-${shortName}`,
    scopeName,
    comment: `${lang.aliases[0] ?? `Jig ${shortName}`} Templates`,
    fileTypes: lang.extensions.map((ext) => ext.replace(/^\./, '')),
    patterns: [
      { include: EMBED_GRAMMAR_SCOPE },
      { include: 'source.jig' },
      { include: lang.hostLanguageScope },
    ],
  }
}

// ---------------------------------------------------------------------------
// Embed grammar generation (cross-language blocks)
// ---------------------------------------------------------------------------

/**
 * Generate the embed.tmLanguage.json grammar.
 *
 * This grammar is a pattern library with scope `meta.embedded.jig-languages`.
 * For each language, it defines an `embedded_<key>` repository rule that matches
 * the language override markers ({{-- :: lang :: --}} / {{-- // lang --}}) and
 * delegates content highlighting to the corresponding per-language jig grammar
 * (text.jig.<lang>).
 *
 * Per-language grammars include this grammar as their first pattern, so that any
 * jig file can embed blocks of any other supported language.
 */
function generateEmbedGrammar(languages: LanguageConfig[]): object {
  const repository: Record<string, any> = {}
  const topLevelPatterns: any[] = []

  for (const lang of languages) {
    const shortName = getShortName(lang)
    const key = getScopeKey(lang)
    const langAlternation = buildLanguageAlternation(lang)
    const perLangScope = getPerLanguageScopeName(lang)

    const embeddedRuleKey = `embedded_${key}`
    topLevelPatterns.push({ include: `#${embeddedRuleKey}` })

    const beginPattern = `\\{\\{--\\s*::\\s*${langAlternation}\\s*::\\s*--\\}\\}`
    const endPattern = `^\\s*\\{\\{--\\s*//\\s*${langAlternation}\\s*--\\}\\}`

    repository[embeddedRuleKey] = {
      contentName: `meta.embedded.block.${shortName}`,
      begin: beginPattern,
      end: endPattern,
      beginCaptures: {
        '0': { name: 'comment.block.jig' },
      },
      endCaptures: {
        '0': { name: 'comment.block.jig' },
      },
      patterns: [{ include: perLangScope }],
    }
  }

  return {
    scopeName: EMBED_GRAMMAR_SCOPE,
    patterns: topLevelPatterns,
    repository,
  }
}

// ---------------------------------------------------------------------------
// Injection grammar generation (for jig-html)
// ---------------------------------------------------------------------------

/** Jig repository patterns included BEFORE host language grammars in the
 * injection grammar (for jig-html). These use line-anchored wrappers for
 * patterns that don't anchor at ^, plus direct includes from jig-html. */
const JIG_REPOSITORY_PATTERNS = [
  '#jig_line_comment',
  '#jig_line_escapedMustache',
  '#jig_line_safeMustache',
  '#jig_line_mustache',
  `${JIG_HTML_SCOPE}#comment`,
  `${JIG_HTML_SCOPE}#escapedMustache`,
  `${JIG_HTML_SCOPE}#safeMustache`,
  `${JIG_HTML_SCOPE}#mustache`,
  `${JIG_HTML_SCOPE}#nonSeekableTag`,
  `${JIG_HTML_SCOPE}#tag`,
]

function buildLineAnchoredPatterns(languages: LanguageConfig[]): Record<string, object> {
  const langNames: string[] = []
  for (const lang of languages) {
    langNames.push(escapeRegex(getShortName(lang)))
    for (const alias of lang.overrideAliases ?? []) {
      langNames.push(escapeRegex(alias))
    }
  }

  return {
    jig_line_comment: {
      begin: `^\\s*(?=\\{\\{--(?!\\s*(?:::|//)\\s*(?i:${langNames.join('|')})))`,
      end: '(?<=--\\}\\})',
      patterns: [{ include: `${JIG_HTML_SCOPE}#comment` }],
    },
    jig_line_escapedMustache: {
      begin: '^\\s*(?=@\\{\\{)',
      end: '(?<=\\}\\})',
      patterns: [{ include: `${JIG_HTML_SCOPE}#escapedMustache` }],
    },
    jig_line_safeMustache: {
      begin: '^\\s*(?=\\{\\{\\{)',
      end: '(?<=\\}\\}\\})',
      patterns: [{ include: `${JIG_HTML_SCOPE}#safeMustache` }],
    },
    jig_line_mustache: {
      begin: '^\\s*(?=\\{\\{[^{-])',
      end: '(?<=\\}\\})',
      patterns: [{ include: `${JIG_HTML_SCOPE}#mustache` }],
    },
  }
}

function generateInjectionGrammar(languages: LanguageConfig[]) {
  const repository: Record<string, any> = {}
  const topLevelPatterns: any[] = []
  const embeddedScopes: string[] = []

  for (const lang of languages) {
    const shortName = getShortName(lang)
    const key = getScopeKey(lang)
    const langAlternation = buildLanguageAlternation(lang)
    const embeddedScope = `meta.embedded.block.${shortName}`

    embeddedScopes.push(embeddedScope)

    const embeddedRuleKey = `embedded_${key}`
    topLevelPatterns.push({ include: `#${embeddedRuleKey}` })

    const beginPattern = `\\{\\{--\\s*::\\s*${langAlternation}\\s*::\\s*--\\}\\}`
    const endPattern = `^\\s*\\{\\{--\\s*//\\s*${langAlternation}\\s*--\\}\\}`

    repository[embeddedRuleKey] = {
      begin: beginPattern,
      end: endPattern,
      beginCaptures: {
        '0': { name: 'comment.block.jig' },
      },
      endCaptures: {
        '0': { name: 'comment.block.jig' },
      },
      contentName: embeddedScope,
      patterns: [
        ...JIG_REPOSITORY_PATTERNS.map((p) => ({ include: p })),
        { include: lang.hostLanguageScope },
      ],
    }
  }

  const exclusions = embeddedScopes.map((s) => ` - ${s}`).join('')
  const injectionSelector = `L:${JIG_HTML_SCOPE}${exclusions}`

  const embeddedLanguages: Record<string, string> = {}
  const tokenTypes: Record<string, string> = {}
  for (const lang of languages) {
    const shortName = getShortName(lang)
    const scope = `meta.embedded.block.${shortName}`
    embeddedLanguages[scope] = resolveVscodeLangId(lang)
    tokenTypes[scope] = 'other'
  }

  const lineAnchoredPatterns = buildLineAnchoredPatterns(languages)
  for (const [key, pattern] of Object.entries(lineAnchoredPatterns)) {
    repository[key] = pattern
  }

  return {
    grammar: {
      $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
      name: 'Jig Embedded Language Overrides',
      scopeName: EMBEDDED_GRAMMAR_SCOPE,
      injectionSelector,
      patterns: topLevelPatterns,
      repository,
    },
    embeddedLanguages,
    tokenTypes,
  }
}

// ---------------------------------------------------------------------------
// Fenced code block injection (for Markdown)
// ---------------------------------------------------------------------------

/**
 * Generate an injection grammar that highlights jig fenced code blocks
 * inside Markdown files.
 *
 * For each language, creates a rule matching e.g. ```jig-ts or ```jig-go
 * and highlights the block content with the corresponding jig grammar.
 * Also supports bare ```jig for the pure Jig language.
 *
 * Based on the pattern used by Marko's VS Code extension.
 */
function generateFencedCodeBlockGrammar(languages: LanguageConfig[]) {
  const repository: Record<string, any> = {}
  const topLevelPatterns: any[] = []
  const embeddedLanguages: Record<string, string> = {}
  const tokenTypes: Record<string, string> = {}

  // Helper to build a fenced code block rule for a given language ID,
  // name alternation, and grammar scope.
  function addFencedRule(
    key: string,
    nameAlternation: string,
    grammarScope: string,
    embeddedBlockScope: string,
    vscodeLangId: string
  ) {
    const ruleKey = `fenced_${key}`
    topLevelPatterns.push({ include: `#${ruleKey}` })
    embeddedLanguages[embeddedBlockScope] = vscodeLangId
    tokenTypes[embeddedBlockScope] = 'other'

    repository[ruleKey] = {
      name: 'markup.fenced_code.block.markdown',
      begin: `(^|\\G)(\\s*)(\`{3,}|~{3,})\\s*(?i:(${nameAlternation})((\\s+|:|,|\\{|\\?)[^\`]*)?$)`,
      beginCaptures: {
        '3': { name: 'punctuation.definition.markdown' },
        '4': { name: 'fenced_code.block.language.markdown' },
        '5': { name: 'fenced_code.block.language.attributes.markdown' },
      },
      end: '(^|\\G)(\\2|\\s{0,3})(\\3)\\s*$',
      endCaptures: {
        '3': { name: 'punctuation.definition.markdown' },
      },
      patterns: [
        {
          begin: '(^|\\G)(\\s*)(.*)',
          while: '(^|\\G)(?!\\s*([`~]{3,})\\s*$)',
          contentName: embeddedBlockScope,
          patterns: [{ include: grammarScope }],
        },
      ],
    }
  }

  // Pure jig: ```jig
  addFencedRule(
    'jig',
    'jig',
    PURE_JIG_LANG.scopeName,
    'meta.embedded.block.jig',
    PURE_JIG_LANG.id
  )

  // Per-language: ```jig-ts, ```jig-go, ```jig-html, etc.
  // Also match the full language ID as well as jig-<aliases>
  for (const lang of languages) {
    const shortName = getShortName(lang)
    const key = getScopeKey(lang)

    // Build alternation: jig-ts|jig-typescript etc.
    const names = [lang.id]
    for (const alias of lang.overrideAliases ?? []) {
      names.push(`jig-${alias}`)
    }
    const nameAlternation = names.map(escapeRegex).join('|')

    // jig-html uses source.jig.html, all others use text.jig.<shortName>
    const grammarScope = lang.id === 'jig-html' ? JIG_HTML_SCOPE : getPerLanguageScopeName(lang)

    addFencedRule(
      key,
      nameAlternation,
      grammarScope,
      `meta.embedded.block.jig-${shortName}`,
      lang.id
    )
  }

  return {
    grammar: {
      information_for_contributors: [
        'This file is auto-generated by scripts/generate-grammars.ts — do not edit manually.',
        '',
        'It injects fenced code block highlighting for Jig languages in Markdown.',
        'Based on: https://github.com/mjbvz/vscode-fenced-code-block-grammar-injection-example',
      ],
      name: 'Fenced Jig Code Blocks in Markdown',
      scopeName: FENCED_CODE_BLOCK_SCOPE,
      injectionSelector: 'L:text.html.markdown - meta.embedded.block.jig, L:source.mdx - meta.embedded.block.jig',
      fileTypes: [],
      patterns: topLevelPatterns,
      repository,
    },
    embeddedLanguages,
    tokenTypes,
  }
}

// ---------------------------------------------------------------------------
// package.json update
// ---------------------------------------------------------------------------

/**
 * Marker scope names for grammar entries that the script manages.
 * Everything else in grammars[] is left untouched (e.g., source.jig, source.jig.html).
 */
const MANAGED_SCOPES = new Set([
  EMBEDDED_GRAMMAR_SCOPE,
  EMBED_GRAMMAR_SCOPE,
  FENCED_CODE_BLOCK_SCOPE,
])

function updatePackageJson(
  languages: LanguageConfig[],
  injectionEmbeddedLanguages: Record<string, string>,
  injectionTokenTypes: Record<string, string>,
  fencedEmbeddedLanguages: Record<string, string>,
  fencedTokenTypes: Record<string, string>
) {
  const packageJson = readJSON(PACKAGE_JSON_FILE)

  // --- Languages ---
  // Keep hand-crafted language entries (jig-html), replace/add generated ones
  const handCraftedLanguages = (packageJson.contributes.languages as any[]).filter(
    (l: any) => l.id === 'jig-html'
  )
  const pureJigLanguage = {
    id: PURE_JIG_LANG.id,
    aliases: ['Jig'],
    extensions: ['.jig'],
    configuration: './language-configuration.json',
  }
  const generatedLanguages = languages
    .filter((l) => l.id !== 'jig-html')
    .map((lang) => ({
      id: lang.id,
      aliases: [lang.aliases[0] ?? lang.id, lang.id],
      extensions: lang.extensions,
      configuration: './language-configuration.json',
    }))
  packageJson.contributes.languages = [...handCraftedLanguages, pureJigLanguage, ...generatedLanguages]

  // --- Grammars ---
  // Keep hand-crafted grammar entries, replace managed ones
  // Build the set of all scope names and language IDs the script manages
  const managedScopeNames = new Set<string>([
    ...MANAGED_SCOPES,
    PURE_JIG_LANG.scopeName,
    ...languages.filter((l) => l.id !== 'jig-html').map(getPerLanguageScopeName),
  ])
  const managedLanguageIds = new Set<string>([
    PURE_JIG_LANG.id,
    ...languages.filter((l) => l.id !== 'jig-html').map((l) => l.id),
  ])
  // Also catch stale grammar entries for languages no longer in languages.json
  // (any grammar with language starting with "jig-" that we don't manage is stale)
  const isStaleGrammar = (g: any) =>
    g.language?.startsWith('jig-') &&
    g.language !== 'jig-html' &&
    !managedLanguageIds.has(g.language)
  const handCraftedGrammars = (packageJson.contributes.grammars as any[]).filter(
    (g: any) =>
      !managedScopeNames.has(g.scopeName) &&
      !managedLanguageIds.has(g.language) &&
      !isStaleGrammar(g)
  )

  const generatedGrammars: any[] = []

  // Pure Jig grammar — reuses source.jig directly, just adds language association
  generatedGrammars.push({
    language: PURE_JIG_LANG.id,
    scopeName: PURE_JIG_LANG.scopeName,
    path: './syntaxes/jig.tmLanguage.json',
  })

  // Per-language grammar entries (no embeddedLanguages/tokenTypes)
  for (const lang of languages) {
    if (lang.id === 'jig-html') continue
    const shortName = getShortName(lang)
    generatedGrammars.push({
      language: lang.id,
      scopeName: getPerLanguageScopeName(lang),
      path: `./syntaxes/generated/jig-${shortName}.tmLanguage.json`,
    })
  }

  // Embed grammar (pattern library for cross-language blocks)
  generatedGrammars.push({
    scopeName: EMBED_GRAMMAR_SCOPE,
    path: './syntaxes/generated/embed.tmLanguage.json',
  })

  // Injection grammar (for jig-html)
  generatedGrammars.push({
    scopeName: EMBEDDED_GRAMMAR_SCOPE,
    path: './syntaxes/generated/jig-embedded-languages.tmLanguage.json',
    injectTo: [JIG_HTML_SCOPE],
    embeddedLanguages: injectionEmbeddedLanguages,
    tokenTypes: injectionTokenTypes,
  })

  // Fenced code block injection (for Markdown)
  generatedGrammars.push({
    scopeName: FENCED_CODE_BLOCK_SCOPE,
    path: './syntaxes/generated/embedded.jig.tmLanguage.json',
    injectTo: ['text.html.markdown', 'source.mdx'],
    embeddedLanguages: fencedEmbeddedLanguages,
    tokenTypes: fencedTokenTypes,
  })

  packageJson.contributes.grammars = [...handCraftedGrammars, ...generatedGrammars]

  writeFileSync(PACKAGE_JSON_FILE, JSON.stringify(packageJson, null, 2))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('Reading languages configuration...')
  const languages: LanguageConfig[] = readJSON(LANGUAGES_FILE)
  const nonHtmlLanguages = languages.filter((l) => l.id !== 'jig-html')

  mkdirSync(GENERATED_DIR, { recursive: true })

  // 1. Generate per-language grammars
  console.log('Generating per-language grammars...')
  const generatedFiles = new Set<string>()

  for (const lang of nonHtmlLanguages) {
    const shortName = getShortName(lang)
    const fileName = `jig-${shortName}.tmLanguage.json`
    const filePath = join(GENERATED_DIR, fileName)
    const grammar = generatePerLanguageGrammar(lang)
    writeFileSync(filePath, JSON.stringify(grammar, null, 2))
    generatedFiles.add(fileName)
  }

  console.log(`Generated ${nonHtmlLanguages.length} per-language grammars`)

  // 2. Generate embed grammar (cross-language blocks)
  console.log('Generating embed grammar...')
  const embedFileName = 'embed.tmLanguage.json'
  const embedGrammar = generateEmbedGrammar(nonHtmlLanguages)
  writeFileSync(join(GENERATED_DIR, embedFileName), JSON.stringify(embedGrammar, null, 2))
  generatedFiles.add(embedFileName)

  // 3. Generate injection grammar (for jig-html)
  console.log('Generating injection grammar for jig-html...')
  const injectionFileName = 'jig-embedded-languages.tmLanguage.json'
  const { grammar: injectionGrammar, embeddedLanguages, tokenTypes } =
    generateInjectionGrammar(languages)
  writeFileSync(join(GENERATED_DIR, injectionFileName), JSON.stringify(injectionGrammar, null, 2))
  generatedFiles.add(injectionFileName)
  console.log(`Generated ${injectionFileName} with ${languages.length} language rules`)

  // 4. Generate fenced code block injection (for Markdown)
  console.log('Generating fenced code block injection grammar...')
  const fencedFileName = 'embedded.jig.tmLanguage.json'
  const {
    grammar: fencedGrammar,
    embeddedLanguages: fencedEmbeddedLanguages,
    tokenTypes: fencedTokenTypes,
  } = generateFencedCodeBlockGrammar(languages)
  writeFileSync(join(GENERATED_DIR, fencedFileName), JSON.stringify(fencedGrammar, null, 2))
  generatedFiles.add(fencedFileName)
  console.log(`Generated ${fencedFileName}`)

  // 5. Clean stale files from generated/
  if (existsSync(GENERATED_DIR)) {
    const existingFiles = readdirSync(GENERATED_DIR)
    for (const file of existingFiles) {
      if (file.endsWith('.tmLanguage.json') && !generatedFiles.has(file)) {
        const filePath = join(GENERATED_DIR, file)
        console.log(`Removing stale grammar: ${file}`)
        unlinkSync(filePath)
      }
    }
  }

  // 6. Update package.json
  console.log('Updating package.json...')
  updatePackageJson(languages, embeddedLanguages, tokenTypes, fencedEmbeddedLanguages, fencedTokenTypes)
  console.log('package.json updated!')

  console.log('Done!')
}

main()
