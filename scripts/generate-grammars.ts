#!/usr/bin/env bun

import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

const ROOT_DIR = join(__dirname, '..')
const LANGUAGES_FILE = join(ROOT_DIR, 'scripts', 'languages.json')
const PACKAGE_JSON_FILE = join(ROOT_DIR, 'package.json')
const SYNTAXES_DIR = join(ROOT_DIR, 'syntaxes')
const SNIPPETS_DIR = join(ROOT_DIR, 'snippets')

interface LanguageConfig {
  id: string
  aliases: string[]
  extensions: string[]
  hostLanguageScope: string
}

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

function main() {
  console.log('Reading languages configuration...')
  const languages: LanguageConfig[] = readJSON(LANGUAGES_FILE)

  const contributions: any = {
    languages: [],
    grammars: [],
    snippets: []
  }

  console.log('Generating grammar files...')

  // Add base Jig grammar to contributions
  contributions.grammars.push({
    language: 'jig',
    scopeName: 'source.jig',
    path: './syntaxes/jig.tmLanguage.json'
  })

  // Base 'jig' language has no file extensions — jig-html claims .jig as the default.
  // This language exists only to provide the source.jig grammar that other languages include.
  contributions.languages.push({
    id: 'jig',
    aliases: ['Jig'],
    extensions: [],
    configuration: './language-configuration.json'
  })

  const generatedGrammarFiles = new Set<string>()
  generatedGrammarFiles.add('jig.tmLanguage.json')

  // Collect all language IDs for snippets scope
  const snippetScopes = ['jig']

  for (const lang of languages) {
    const grammarFileName = `${lang.id}.tmLanguage.json`
    const grammarPath = join(SYNTAXES_DIR, grammarFileName)
    generatedGrammarFiles.add(grammarFileName)

    snippetScopes.push(lang.id)

    const grammarContent = {
      $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
      name: lang.aliases[0],
      scopeName: `text.jig.${lang.id.replace('jig-', '')}`,
      patterns: [
        { include: "source.jig" },
        { include: lang.hostLanguageScope }
      ]
    }

    writeFileSync(grammarPath, JSON.stringify(grammarContent, null, 2))

    // Entries starting with '.' are extensions; others are filenames (e.g. Makefile.jig)
    const extensions = lang.extensions.filter(e => e.startsWith('.'))
    const filenames = lang.extensions.filter(e => !e.startsWith('.'))

    const langContrib: any = {
      id: lang.id,
      aliases: lang.aliases,
      extensions,
      configuration: './language-configuration.json'
    }
    if (filenames.length > 0) {
      langContrib.filenames = filenames
    }
    contributions.languages.push(langContrib)

    contributions.grammars.push({
      language: lang.id,
      scopeName: grammarContent.scopeName,
      path: `./syntaxes/${grammarFileName}`
    })
  }

  // Update scope on jig.code-snippets
  console.log('Updating snippet scopes...')
  const scopeString = snippetScopes.join(',')

  const jigSnippetsPath = join(SNIPPETS_DIR, 'jig.code-snippets')
  const jigSnippets = readJSON(jigSnippetsPath)
  for (const key in jigSnippets) {
    jigSnippets[key].scope = scopeString
  }
  writeFileSync(jigSnippetsPath, JSON.stringify(jigSnippets, null, 2))
  console.log(`Set scope on jig.code-snippets for ${snippetScopes.length} languages`)

  // Add snippet contributions
  contributions.snippets.push(
    { path: './snippets/jig.code-snippets' },
    { path: './snippets/javascript.code-snippets' }
  )

  // Remove stale grammar files
  console.log('Cleaning up stale grammar files...')
  const existingFiles = readdirSync(SYNTAXES_DIR)
  for (const file of existingFiles) {
    if (file.endsWith('.tmLanguage.json') && !generatedGrammarFiles.has(file)) {
      const filePath = join(SYNTAXES_DIR, file)
      console.log(`Removing stale grammar: ${file}`)
      unlinkSync(filePath)
    }
  }

  console.log('Updating package.json...')
  const packageJson = readJSON(PACKAGE_JSON_FILE)

  packageJson.contributes.languages = contributions.languages
  packageJson.contributes.grammars = contributions.grammars
  packageJson.contributes.snippets = contributions.snippets

  writeFileSync(PACKAGE_JSON_FILE, JSON.stringify(packageJson, null, 2))
  console.log('package.json updated!')
}

main()
