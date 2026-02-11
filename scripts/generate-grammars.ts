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
  injectionSelector?: string
  hasGreedyContexts?: boolean
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
  if (lang.id === 'jig-html') return 'source.jig.html'
  return `text.jig.${getShortName(lang)}`
}

// ---------------------------------------------------------------------------
// Language alternation for embeds — matches ALL language short names + aliases
// ---------------------------------------------------------------------------

function buildAllLanguageAlternation(languages: LanguageConfig[]): string {
  const names: string[] = []
  for (const lang of languages) {
    names.push(escapeRegex(getShortName(lang)))
    for (const alias of lang.overrideAliases ?? []) {
      names.push(escapeRegex(alias))
    }
  }
  return `(?i:${names.join('|')})`
}

// ---------------------------------------------------------------------------
// Embed tag rule generators
// ---------------------------------------------------------------------------

/**
 * Generate an embed tag rule for a specific target language.
 *
 * For languages with greedy contexts (markdown): uses begin/while at top level.
 * For non-greedy languages: uses begin/end at top level (allows jig_block inside).
 *
 * @param targetLang - the language being embedded
 * @param injected - if true, uses (^|\G) anchors and begin/while (for markdown injection)
 */
function generateEmbedTagRule(
  targetLang: LanguageConfig,
  injected: boolean
): object {
  const shortName = getShortName(targetLang)
  const key = getScopeKey(targetLang)
  const langAlternation = buildLanguageAlternation(targetLang)
  const hasGreedy = targetLang.hasGreedyContexts === true
  const hostScope = targetLang.hostLanguageScope

  const anchor = injected ? '(^|\\G)' : '^'
  // Capture group offset: injected has an extra group for (^|\G)
  const capOffset = injected ? 1 : 0

  const beginPattern = `${anchor}(\\s*)(@{1,2}(!)?[a-zA-Z._]+\\s{0,2})(\\([^)]*\\))(\\s*:\\s*${langAlternation})\\s*$`

  const beginCaptures: Record<string, object> = {}
  beginCaptures[String(2 + capOffset)] = { name: 'support.function.jig' }
  beginCaptures[String(4 + capOffset)] = { name: 'meta.embedded.block.javascript' }
  beginCaptures[String(5 + capOffset)] = { name: 'storage.type.embedded.jig' }

  // Build inner patterns
  const patterns: object[] = []

  // Non-greedy, non-injected: can use jig_block to consume nested @tag...@end
  if (!hasGreedy && !injected) {
    patterns.push({ include: `#jig_block_${key}` })
  }
  patterns.push({ include: 'source.jig' })
  patterns.push({ include: hostScope })

  // Greedy languages or injected variants always use begin/while
  if (hasGreedy || injected) {
    const whilePattern = `${anchor}(?!\\${injected ? '2' : '1'}@end\\s*$)`
    return {
      contentName: `meta.embedded.block.${shortName}`,
      begin: beginPattern,
      beginCaptures,
      while: whilePattern,
      patterns,
    }
  }

  // Non-greedy at top level: begin/end
  return {
    contentName: `meta.embedded.block.${shortName}`,
    begin: beginPattern,
    beginCaptures,
    end: '^\\s*(@end)\\s*$',
    endCaptures: {
      '1': { name: 'support.function.jig' },
    },
    patterns,
  }
}

/**
 * Generate a jig_block recursive consumer for a specific host language.
 * Consumes @tag(...)...@end pairs so inner @end doesn't leak to outer embed.
 */
function generateJigBlock(hostScope: string, selfRef: string): object {
  return {
    comment: `Consumes @tag(...)...@end pairs (host = ${hostScope})`,
    begin: '^(\\s*)(@{1,2}(!)?[a-zA-Z._]+\\s{0,2})(\\([^)]*\\))\\s*$',
    beginCaptures: {
      '2': { name: 'support.function.jig' },
      '4': { name: 'meta.embedded.block.javascript' },
    },
    end: '^\\s*(@end[a-zA-Z]*)\\s*$',
    endCaptures: {
      '1': { name: 'support.function.jig' },
    },
    patterns: [
      { include: `#${selfRef}` },
      { include: 'source.jig' },
      { include: hostScope },
    ],
  }
}

/**
 * Generate the jig_embed_inner_patterns repository entry.
 * These are inlined Jig patterns with (^|\G) anchors for markdown injection piercing.
 */
function generateJigEmbedInnerPatterns(): object {
  return {
    comment: 'Jig patterns for use inside embed blocks via injection. Includes all of source.jig\'s patterns inlined so they pierce markdown contexts.',
    patterns: [
      {
        comment: 'Jig comment',
        begin: '\\{{--',
        end: '\\--}}',
        beginCaptures: { '0': { name: 'punctuation.definition.comment.begin.jig' } },
        endCaptures: { '0': { name: 'punctuation.definition.comment.end.jig' } },
        name: 'comment.block',
      },
      {
        comment: 'Escaped mustache',
        begin: '\\@{{',
        end: '\\}}',
        beginCaptures: { '0': { name: 'punctuation.definition.comment.begin.jig' } },
        endCaptures: { '0': { name: 'punctuation.definition.comment.end.jig' } },
        name: 'comment.block',
      },
      {
        comment: 'Safe mustache',
        begin: '\\{{{',
        end: '\\}}}',
        beginCaptures: { '0': { name: 'punctuation.mustache.begin' } },
        endCaptures: { '0': { name: 'punctuation.mustache.end' } },
        name: 'meta.embedded.block.javascript',
        patterns: [{ include: 'source.ts#expression' }],
      },
      {
        comment: 'Mustache',
        begin: '\\{{',
        end: '\\}}',
        beginCaptures: { '0': { name: 'punctuation.mustache.begin' } },
        endCaptures: { '0': { name: 'punctuation.mustache.end' } },
        name: 'meta.embedded.block.javascript',
        patterns: [{ include: 'source.ts#expression' }],
      },
      {
        comment: 'Non-seekable tag (@end, @else, etc.) — scoping only, no nesting',
        match: '(^|\\G)(\\s*)((@{1,2})(!)?([a-zA-Z._]+))(~)?$',
        captures: {
          '3': { name: 'support.function.jig' },
        },
      },
      {
        comment: 'Tag with parens — scoping only, no nesting',
        begin: '(^|\\G)(\\s*)((@{1,2})(!)?([a-zA-Z._]+)(\\s{0,2}))(\\()',
        beginCaptures: {
          '3': { name: 'support.function.jig' },
          '8': { name: 'punctuation.paren.open' },
        },
        end: '\\)',
        endCaptures: {
          '0': { name: 'punctuation.paren.close' },
        },
        name: 'meta.embedded.block.javascript',
        patterns: [{ include: 'source.ts#expression' }],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Per-language grammar generation
// ---------------------------------------------------------------------------

/**
 * Generate a per-language grammar with full tag-based embed support.
 *
 * Each grammar includes:
 * - Repository rules: jig_embed_inner_patterns, jig_block, embed_tag_<key>, embed_tag_<key>_injected, jig_block_<key>
 * - Two injection contexts: primary (L:<scope>) and markdown-piercing (L:meta.embedded.block.markdown)
 * - Top-level patterns: embed tags → source.jig → host grammar
 */
function generatePerLanguageGrammar(lang: LanguageConfig, allLanguages: LanguageConfig[]): object {
  const shortName = getShortName(lang)
  const scopeName = getPerLanguageScopeName(lang)
  const isHtml = lang.id === 'jig-html'

  // Build repository
  const repository: Record<string, any> = {}

  // jig_embed_inner_patterns (shared across all grammars)
  repository['jig_embed_inner_patterns'] = generateJigEmbedInnerPatterns()

  // jig_block — recursive consumer using this grammar's host language
  repository['jig_block'] = generateJigBlock(lang.hostLanguageScope, 'jig_block')

  // For each target embed language, generate embed rules
  const topLevelPatterns: object[] = []
  const primaryInjectionPatterns: object[] = []
  const mdInjectionPatterns: object[] = []

  // Track if any target has greedy contexts (for markdown injection)
  let hasGreedyTarget = false

  for (const targetLang of allLanguages) {
    const targetKey = getScopeKey(targetLang)

    // embed_tag_<key> — top-level (non-injected) version
    repository[`embed_tag_${targetKey}`] = generateEmbedTagRule(targetLang, false)

    // embed_tag_<key>_injected — (^|\G) anchored version for markdown injection
    repository[`embed_tag_${targetKey}_injected`] = generateEmbedTagRule(targetLang, true)

    // jig_block_<key> — recursive block consumer for non-greedy targets
    if (!targetLang.hasGreedyContexts) {
      repository[`jig_block_${targetKey}`] = generateJigBlock(
        targetLang.hostLanguageScope,
        `jig_block_${targetKey}`
      )
    }

    topLevelPatterns.push({ include: `#embed_tag_${targetKey}` })
    primaryInjectionPatterns.push({ include: `#embed_tag_${targetKey}` })
    mdInjectionPatterns.push({ include: `#embed_tag_${targetKey}_injected` })

    if (targetLang.hasGreedyContexts) {
      hasGreedyTarget = true
    }
  }

  // Add source.jig to primary injection
  primaryInjectionPatterns.push({ include: 'source.jig' })

  // Add jig_embed_inner_patterns to markdown injection
  mdInjectionPatterns.push({ include: '#jig_embed_inner_patterns' })

  // Top-level patterns: embed tags → source.jig → host grammar(s)
  topLevelPatterns.push({ include: 'source.jig' })
  if (isHtml) {
    topLevelPatterns.push({ include: 'text.html.basic' })
    topLevelPatterns.push({ include: 'text.html.derivative' })
  } else {
    topLevelPatterns.push({ include: lang.hostLanguageScope })
  }

  // Build injection selectors
  const injections: Record<string, object> = {}

  // Primary injection
  let primarySelector: string
  if (isHtml) {
    // jig-html needs a more complex injection selector
    primarySelector = [
      `${scopeName} - (meta.embedded | meta.tag | comment.block.jig)`,
      `L:(${scopeName} meta.tag - (comment.block.jig | meta.embedded.block.jig))`,
      `L:(source.ts.embedded.html - (comment.block.jig | meta.embedded.block.jig))`,
    ].join(', ')
  } else {
    primarySelector =
      lang.injectionSelector ??
      `L:${scopeName} - (comment.block | comment.block.jig | meta.embedded)`
  }

  injections[primarySelector] = {
    patterns: primaryInjectionPatterns,
  }

  // Markdown-piercing injection (only if markdown is a supported embed target)
  if (hasGreedyTarget) {
    injections['L:meta.embedded.block.markdown - (comment.block | comment.block.jig)'] = {
      comment: 'Pierce markdown greedy contexts (paragraph, list) so Jig embed tags, tags, and mustache still highlight.',
      patterns: mdInjectionPatterns,
    }
  }

  return {
    name: `jig-${shortName}`,
    scopeName,
    comment: `${lang.aliases[0] ?? `Jig ${shortName}`} Templates — auto-generated by scripts/generate-grammars.ts`,
    fileTypes: lang.extensions.map((ext) => ext.replace(/^\./, '')),
    injections,
    patterns: topLevelPatterns,
    repository,
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
  for (const lang of languages) {
    const shortName = getShortName(lang)
    const key = getScopeKey(lang)

    // Build alternation: jig-ts|jig-typescript etc.
    const names = [lang.id]
    for (const alias of lang.overrideAliases ?? []) {
      names.push(`jig-${alias}`)
    }
    const nameAlternation = names.map(escapeRegex).join('|')

    const grammarScope = getPerLanguageScopeName(lang)

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
 * Everything else in grammars[] is left untouched (e.g., source.jig).
 */
const MANAGED_SCOPES = new Set([
  FENCED_CODE_BLOCK_SCOPE,
])

function updatePackageJson(
  languages: LanguageConfig[],
  fencedEmbeddedLanguages: Record<string, string>,
  fencedTokenTypes: Record<string, string>
) {
  const packageJson = readJSON(PACKAGE_JSON_FILE)

  // --- Languages ---
  // Keep only non-generated entries (none currently — we generate everything)
  const pureJigLanguage = {
    id: PURE_JIG_LANG.id,
    aliases: ['Jig'],
    extensions: ['.jig'],
    configuration: './language-configuration.json',
  }

  // jig-html gets special aliases treatment
  const generatedLanguages = languages.map((lang) => {
    const entry: any = {
      id: lang.id,
      aliases: [lang.aliases[0] ?? lang.id, lang.id],
      extensions: lang.extensions,
      configuration: './language-configuration.json',
    }
    return entry
  })
  packageJson.contributes.languages = [pureJigLanguage, ...generatedLanguages]

  // --- Grammars ---
  // Build the set of all scope names the script manages
  const managedScopeNames = new Set<string>([
    ...MANAGED_SCOPES,
    PURE_JIG_LANG.scopeName,
    ...languages.map(getPerLanguageScopeName),
  ])
  const managedLanguageIds = new Set<string>([
    PURE_JIG_LANG.id,
    ...languages.map((l) => l.id),
  ])

  // Also remove old stale scopes
  const oldScopes = new Set([
    'meta.embedded.jig-languages',
    'source.jig.embedded.language',
  ])

  const handCraftedGrammars = (packageJson.contributes.grammars as any[]).filter(
    (g: any) =>
      !managedScopeNames.has(g.scopeName) &&
      !managedLanguageIds.has(g.language) &&
      !oldScopes.has(g.scopeName) &&
      // Remove stale jig- grammars
      !(g.language?.startsWith('jig-') && !managedLanguageIds.has(g.language))
  )

  const generatedGrammars: any[] = []

  // Pure Jig grammar — reuses source.jig directly, just adds language association
  generatedGrammars.push({
    language: PURE_JIG_LANG.id,
    scopeName: PURE_JIG_LANG.scopeName,
    path: './syntaxes/jig.tmLanguage.json',
  })

  // Build embeddedLanguages map used across all per-language grammars
  const embeddedLanguagesMap: Record<string, string> = {}
  const tokenTypesMap: Record<string, string> = {}
  for (const targetLang of languages) {
    const targetShortName = getShortName(targetLang)
    const scope = `meta.embedded.block.${targetShortName}`
    embeddedLanguagesMap[scope] = resolveVscodeLangId(targetLang)
    tokenTypesMap[scope] = 'other'
  }

  // Per-language grammar entries (all languages including jig-html)
  for (const lang of languages) {
    const shortName = getShortName(lang)
    generatedGrammars.push({
      language: lang.id,
      scopeName: getPerLanguageScopeName(lang),
      path: `./syntaxes/generated/jig-${shortName}.tmLanguage.json`,
      embeddedLanguages: { ...embeddedLanguagesMap },
      tokenTypes: { ...tokenTypesMap },
    })
  }

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

  mkdirSync(GENERATED_DIR, { recursive: true })

  // 1. Generate per-language grammars (ALL languages including jig-html)
  console.log('Generating per-language grammars with tag-based embeds...')
  const generatedFiles = new Set<string>()

  for (const lang of languages) {
    const shortName = getShortName(lang)
    const fileName = `jig-${shortName}.tmLanguage.json`
    const filePath = join(GENERATED_DIR, fileName)
    const grammar = generatePerLanguageGrammar(lang, languages)
    writeFileSync(filePath, JSON.stringify(grammar, null, 2))
    generatedFiles.add(fileName)
  }

  console.log(`Generated ${languages.length} per-language grammars`)

  // 2. Generate fenced code block injection (for Markdown)
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

  // 3. Clean stale files from generated/
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

  // 4. Update package.json
  console.log('Updating package.json...')
  updatePackageJson(languages, fencedEmbeddedLanguages, fencedTokenTypes)
  console.log('package.json updated!')

  console.log('Done!')
}

main()
