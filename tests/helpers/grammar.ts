import * as path from 'path'
import * as fs from 'fs'
import * as vsctm from 'vscode-textmate'
import * as oniguruma from 'vscode-oniguruma'

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const FIXTURE_GRAMMARS_DIR = path.resolve(__dirname, '../fixtures/grammars')
const WASM_PATH = path.resolve(__dirname, '../../node_modules/vscode-oniguruma/release/onig.wasm')

/**
 * Build a map of scopeName → absolute file path.
 *
 * Extension grammars are loaded ONLY from paths registered in package.json
 * (mirroring what real VSCode does). This prevents tests from passing when
 * a grammar file exists on disk but isn't registered — which would silently
 * break the real extension.
 *
 * Fixture grammars (tests/fixtures/grammars/) simulate VSCode's built-in
 * extensions (YAML, Markdown, etc.) and are always loaded.
 */
function buildScopeMap(): Map<string, string> {
  const map = new Map<string, string>()

  // 1. Load extension grammars from package.json (just like VSCode does)
  const pkgPath = path.join(PROJECT_ROOT, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const registeredGrammars: Array<{ scopeName: string; path: string }> = pkg.contributes?.grammars || []
  for (const entry of registeredGrammars) {
    if (!entry.scopeName || !entry.path) continue
    const filePath = path.resolve(PROJECT_ROOT, entry.path)
    if (fs.existsSync(filePath)) {
      map.set(entry.scopeName, filePath)
    }
  }

  // 2. Load fixture grammars (simulating VSCode built-in extensions)
  if (fs.existsSync(FIXTURE_GRAMMARS_DIR)) {
    const files = fs.readdirSync(FIXTURE_GRAMMARS_DIR).filter((f) => f.endsWith('.tmLanguage.json'))
    for (const file of files) {
      const filePath = path.join(FIXTURE_GRAMMARS_DIR, file)
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (content.scopeName) {
        map.set(content.scopeName, filePath)
      }
    }
  }

  return map
}

const scopeMap = buildScopeMap()

/** The embedded-language injection grammar scope */
const EMBEDDED_INJECTION_SCOPE = 'source.jig.embedded.language'

/**
 * Minimal stub grammars for host languages referenced by Jig grammars.
 *
 * vscode-textmate silently drops begin/end patterns whose inner `patterns`
 * include a grammar that resolves to null. The Jig base grammar references
 * `source.ts#expression` inside mustache and tag patterns, so we must
 * provide a minimal stub with an empty `expression` repository entry.
 *
 * Real host grammars (e.g., text.html.markdown) are loaded from
 * tests/fixtures/grammars/ so we test against actual VSCode behavior.
 */
const STUB_GRAMMARS: Record<string, object> = {
  'source.ts': {
    scopeName: 'source.ts',
    patterns: [],
    repository: { expression: { patterns: [] } },
  },
  'text.html.basic': {
    scopeName: 'text.html.basic',
    patterns: [],
    repository: {},
  },
  'text.html.derivative': {
    scopeName: 'text.html.derivative',
    patterns: [],
    repository: {},
  },
}

let onigurumaReady: Promise<vsctm.IOnigLib> | null = null

function getOnigLib(): Promise<vsctm.IOnigLib> {
  if (!onigurumaReady) {
    const wasmBin = fs.readFileSync(WASM_PATH).buffer
    onigurumaReady = oniguruma.loadWASM({ data: wasmBin }).then(() => ({
      createOnigScanner(patterns: string[]) {
        return new oniguruma.OnigScanner(patterns)
      },
      createOnigString(s: string) {
        return new oniguruma.OnigString(s)
      },
    }))
  }
  return onigurumaReady
}

function createRegistry(): vsctm.Registry {
  return new vsctm.Registry({
    onigLib: getOnigLib(),
    loadGrammar(scopeName: string): Promise<vsctm.IRawGrammar | null> {
      // Our extension's grammars
      const filePath = scopeMap.get(scopeName)
      if (filePath) {
        const content = fs.readFileSync(filePath, 'utf-8')
        return Promise.resolve(vsctm.parseRawGrammar(content, filePath))
      }
      // Stubs for critical host grammars
      if (STUB_GRAMMARS[scopeName]) {
        return Promise.resolve(STUB_GRAMMARS[scopeName] as vsctm.IRawGrammar)
      }
      // Unknown scope
      return Promise.resolve(null)
    },
    getInjections(scopeName: string): string[] | undefined {
      // Don't inject into the injection grammar itself
      if (scopeName === EMBEDDED_INJECTION_SCOPE) {
        return undefined
      }
      // For source.jig.html, inject the embedded-language override grammar
      if (scopeName === 'source.jig.html') {
        return [EMBEDDED_INJECTION_SCOPE]
      }
      return undefined
    },
  })
}

export interface TokenInfo {
  text: string
  scopes: string[]
}

export interface LineTokens {
  line: string
  tokens: TokenInfo[]
}

/**
 * Tokenize content using a given grammar scope.
 * Returns token info for each line.
 */
export async function tokenizeContent(
  scopeName: string,
  content: string
): Promise<LineTokens[]> {
  const registry = createRegistry()
  const grammar = await registry.loadGrammar(scopeName)
  if (!grammar) {
    throw new Error(`Grammar not found for scope: ${scopeName}`)
  }

  const lines = content.split('\n')
  const result: LineTokens[] = []
  let ruleStack = vsctm.INITIAL

  for (const line of lines) {
    const lineResult = grammar.tokenizeLine(line, ruleStack)
    const tokens: TokenInfo[] = lineResult.tokens.map((t) => ({
      text: line.substring(t.startIndex, t.endIndex),
      scopes: t.scopes,
    }))
    result.push({ line, tokens })
    ruleStack = lineResult.ruleStack
  }

  registry.dispose()
  return result
}

// ---------------------------------------------------------------------------
// Token lookup helpers — line-aware, exact-match
// ---------------------------------------------------------------------------

/**
 * Get the first token on a specific line (0-indexed) that matches the given text exactly.
 * Returns undefined if not found.
 */
export function getToken(result: LineTokens[], lineIndex: number, text: string): TokenInfo | undefined {
  const line = result[lineIndex]
  if (!line) return undefined
  return line.tokens.find((t) => t.text === text)
}

/**
 * Get all tokens on a specific line (0-indexed) that match the given text exactly.
 */
export function getTokens(result: LineTokens[], lineIndex: number, text: string): TokenInfo[] {
  const line = result[lineIndex]
  if (!line) return []
  return line.tokens.filter((t) => t.text === text)
}

/**
 * Get all tokens on a specific line (0-indexed).
 */
export function getLineTokens(result: LineTokens[], lineIndex: number): TokenInfo[] {
  const line = result[lineIndex]
  if (!line) return []
  return line.tokens
}

// ---------------------------------------------------------------------------
// Scope assertion helpers — exact scope name matching (no substring)
// ---------------------------------------------------------------------------

/**
 * Check if a token has a specific scope (exact match, not substring).
 */
export function tokenHasScope(token: TokenInfo, scope: string): boolean {
  return token.scopes.includes(scope)
}

/**
 * Check if a token has ALL of the given scopes (exact match each).
 */
export function tokenHasAllScopes(token: TokenInfo, scopes: string[]): boolean {
  return scopes.every((s) => token.scopes.includes(s))
}

/**
 * Check if a token does NOT have any of the given scopes (exact match each).
 */
export function tokenLacksAllScopes(token: TokenInfo, scopes: string[]): boolean {
  return scopes.every((s) => !token.scopes.includes(s))
}

/**
 * Format a token's scopes for assertion messages.
 */
export function formatScopes(token: TokenInfo): string {
  return `"${token.text}" → [${token.scopes.join(', ')}]`
}

// ---------------------------------------------------------------------------
// Legacy helpers (kept for compatibility but prefer the above)
// ---------------------------------------------------------------------------

/**
 * Find all tokens across all lines that have a scope matching the given fragment.
 * WARNING: Uses substring matching — prefer getToken() + tokenHasScope() for new tests.
 */
export function findTokensWithScope(result: LineTokens[], scopeFragment: string): TokenInfo[] {
  const found: TokenInfo[] = []
  for (const lineResult of result) {
    for (const token of lineResult.tokens) {
      if (token.scopes.some((s) => s.includes(scopeFragment))) {
        found.push(token)
      }
    }
  }
  return found
}

/**
 * Find all tokens across all lines matching the given text exactly.
 * WARNING: Searches all lines — prefer getToken(result, lineIndex, text) for new tests.
 */
export function findTokensAtText(result: LineTokens[], text: string): TokenInfo[] {
  const found: TokenInfo[] = []
  for (const lineResult of result) {
    for (const token of lineResult.tokens) {
      if (token.text === text) {
        found.push(token)
      }
    }
  }
  return found
}

/**
 * Dump all tokens for debugging. Returns a formatted string.
 */
export function dumpTokens(result: LineTokens[]): string {
  return result
    .map((lr, i) =>
      lr.tokens.map((t) => `  L${i}: "${t.text}" → [${t.scopes.join(', ')}]`).join('\n')
    )
    .join('\n')
}
