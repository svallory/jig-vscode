import * as fs from 'fs'
import * as path from 'path'
import { test } from '@japa/runner'
import {
  tokenizeContent,
  getToken,
  getTokens,
  getLineTokens,
  tokenHasScope,
  tokenHasAllScopes,
  tokenLacksAllScopes,
  formatScopes,
  dumpTokens,
} from './helpers/grammar'

// All tests use source.jig.html as the primary grammar (matching Edge.js pattern).
// Every assertion is line-aware (pinned to a specific line index) and uses
// exact scope matching (no substring tricks).

test.group('Grammar Scopes | Jig HTML grammar (source.jig.html)', () => {
  // ------- Comments -------

  test('{{-- comment --}}: opening delimiter gets punctuation.definition.comment.begin.jig', async ({
    assert,
  }) => {
    const result = await tokenizeContent('source.jig.html', '{{-- this is a comment --}}')
    const token = getToken(result, 0, '{{--')
    assert.isDefined(token, 'Expected {{-- token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.definition.comment.begin.jig'),
      `Missing punctuation.definition.comment.begin.jig: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'comment.block'),
      `Missing comment.block: ${formatScopes(token!)}`
    )
  })

  test('{{-- comment --}}: closing delimiter gets punctuation.definition.comment.end.jig', async ({
    assert,
  }) => {
    const result = await tokenizeContent('source.jig.html', '{{-- this is a comment --}}')
    const token = getToken(result, 0, '--}}')
    assert.isDefined(token, 'Expected --}} token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.definition.comment.end.jig'),
      `Missing punctuation.definition.comment.end.jig: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'comment.block'),
      `Missing comment.block: ${formatScopes(token!)}`
    )
  })

  test('{{-- comment --}}: inner text is inside comment.block', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '{{-- inner text --}}')
    const token = getToken(result, 0, ' inner text ')
    assert.isDefined(token, 'Expected inner text token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block'),
      `Missing comment.block: ${formatScopes(token!)}`
    )
  })

  // ------- Escaped mustache -------

  test('@{{ escaped }}: @{{ gets comment.block scope', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '@{{ escaped }}')
    const token = getToken(result, 0, '@{{')
    assert.isDefined(token, 'Expected @{{ token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block'),
      `Missing comment.block: ${formatScopes(token!)}`
    )
  })

  // ------- Mustache -------

  test('{{ expr }}: {{ gets punctuation.mustache.begin', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '{{ expr }}')
    const token = getToken(result, 0, '{{')
    assert.isDefined(token, 'Expected {{ token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.mustache.begin'),
      `Missing punctuation.mustache.begin: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.javascript'),
      `Missing meta.embedded.block.javascript: ${formatScopes(token!)}`
    )
  })

  test('{{ expr }}: }} gets punctuation.mustache.end', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '{{ expr }}')
    const token = getToken(result, 0, '}}')
    assert.isDefined(token, 'Expected }} token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.mustache.end'),
      `Missing punctuation.mustache.end: ${formatScopes(token!)}`
    )
  })

  test('{{ expr }}: content is inside meta.embedded.block.javascript', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '{{ someVar }}')
    const token = getToken(result, 0, 'someVar')
    assert.isDefined(token, 'Expected "someVar" token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.javascript'),
      `Missing meta.embedded.block.javascript: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'source.jig.html'),
      `Missing source.jig.html root scope: ${formatScopes(token!)}`
    )
  })

  // ------- Safe mustache -------

  test('{{{ safe }}}: content is inside meta.embedded.block.javascript', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '{{{ safeVar }}}')
    const token = getToken(result, 0, 'safeVar')
    assert.isDefined(token, 'Expected "safeVar" token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.javascript'),
      `Missing meta.embedded.block.javascript: ${formatScopes(token!)}`
    )
  })

  // ------- Tags with parens -------

  test('@if(condition): @if gets support.function.jig + meta.embedded.block.javascript + source.jig.html', async ({
    assert,
  }) => {
    const result = await tokenizeContent('source.jig.html', '@if(condition)')
    const token = getToken(result, 0, '@if')
    assert.isDefined(token, 'Expected @if token on line 0')
    assert.isTrue(
      tokenHasAllScopes(token!, [
        'support.function.jig',
        'meta.embedded.block.javascript',
        'source.jig.html',
      ]),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
  })

  test('@if(condition): ( gets punctuation.paren.open', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '@if(condition)')
    const token = getToken(result, 0, '(')
    assert.isDefined(token, 'Expected ( token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.paren.open'),
      `Missing punctuation.paren.open: ${formatScopes(token!)}`
    )
  })

  test('@if(condition): ) gets punctuation.paren.close', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '@if(condition)')
    const token = getToken(result, 0, ')')
    assert.isDefined(token, 'Expected ) token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.paren.close'),
      `Missing punctuation.paren.close: ${formatScopes(token!)}`
    )
  })

  test('@each(item in items): @each gets support.function.jig', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '@each(item in items)')
    const token = getToken(result, 0, '@each')
    assert.isDefined(token, 'Expected @each token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test("@!component('name'): @!component gets support.function.jig", async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', "@!component('name')")
    const token = getToken(result, 0, "@!component")
    assert.isDefined(token, 'Expected @!component token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  // ------- Non-seekable tags (no parens) -------

  test('@end: gets support.function.jig + meta.embedded.block.javascript + source.jig.html', async ({
    assert,
  }) => {
    const result = await tokenizeContent('source.jig.html', '@end')
    const token = getToken(result, 0, '@end')
    assert.isDefined(token, 'Expected @end token on line 0')
    assert.isTrue(
      tokenHasAllScopes(token!, [
        'support.function.jig',
        'meta.embedded.block.javascript',
        'source.jig.html',
      ]),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
  })

  test('@@section: gets support.function.jig (double-at)', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', "@@section('main')")
    const token = getToken(result, 0, "@@section")
    assert.isDefined(token, 'Expected @@section token on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })
})

test.group('Grammar Scopes | Multiline template', () => {
  const content = [
    '{{-- a comment --}}',  // L0
    '@if(showHeader)',       // L1
    '  {{ title }}',         // L2
    '@end',                  // L3
  ].join('\n')

  test('line 0: {{-- gets comment.block + punctuation.definition.comment.begin.jig', async ({
    assert,
  }) => {
    const result = await tokenizeContent('source.jig.html', content)
    const token = getToken(result, 0, '{{--')
    assert.isDefined(token, 'Expected {{-- on line 0')
    assert.isTrue(
      tokenHasAllScopes(token!, ['comment.block', 'punctuation.definition.comment.begin.jig']),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
  })

  test('line 1: @if gets support.function.jig', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', content)
    const token = getToken(result, 1, '@if')
    assert.isDefined(token, 'Expected @if on line 1')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('line 2: {{ gets punctuation.mustache.begin inside meta.embedded.block.javascript', async ({
    assert,
  }) => {
    const result = await tokenizeContent('source.jig.html', content)
    const token = getToken(result, 2, '{{')
    assert.isDefined(token, 'Expected {{ on line 2')
    assert.isTrue(
      tokenHasAllScopes(token!, ['punctuation.mustache.begin', 'meta.embedded.block.javascript']),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
  })

  test('line 3: @end gets support.function.jig', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', content)
    const token = getToken(result, 3, '@end')
    assert.isDefined(token, 'Expected @end on line 3')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })
})

test.group('Grammar Scopes | Full fixture (example.html.jig)', () => {
  // Uses the real fixture file with blank lines, leading whitespace, and a
  // markdown language-override block. This catches regressions where host
  // grammars' greedy patterns (e.g., markdown's meta.paragraph) swallow Jig
  // syntax after blank lines.
  //
  // Fixture line numbers (0-indexed):
  //  0: <!-- Example for jig-html -->
  //  1: <div class="{{ className }}">
  //  2:   <h1>{{ title }}</h1>
  //  3:   @if(user.isLoggedIn)
  //  4:     <p>Welcome back, {{ user.name }}!</p>
  //  5:   @else
  //  6:     <p>Please <a href="/login">log in</a>.</p>
  //  7:   @endif
  //  8:   (blank)
  //  9:   <ul>
  // 10:     @each(item in items)
  // 11:       <li class="@if(item.active) active @endif">
  // 12:         {{ item.label }}
  // 13:       </li>
  // 14:     @endeach
  // 15:   </ul>
  // 16:   (blank)
  // 17:   {{-- This is a Jig comment --}}
  // 18:   {{ escapedHtml }}
  // 19:   {{{ unescapedHtml }}}
  // 20:   (blank)
  // 21:   {{-- :: markdown :: --}}
  // 22:   # Welcome
  // 23:   (blank)
  // 24:   This is a **bold** statement and some *italic* text.
  // 25:   (blank)
  // 26:   @if(showDetails)
  // 27:     - Item one
  // 28:     - Item two
  // 29:   @endif
  // 30:   (blank)
  // 31:   {{ dynamicContent }}
  // 32:   {{{ escapedDynamicContent }}}
  // 33:   {{-- // markdown --}}
  // 34: </div>

  const fixtureContent = fs.readFileSync(
    path.resolve(__dirname, 'fixtures/example.html.jig'),
    'utf-8'
  )
  let cachedResult: Awaited<ReturnType<typeof tokenizeContent>> | null = null
  async function getResult() {
    if (!cachedResult) {
      cachedResult = await tokenizeContent('source.jig.html', fixtureContent)
    }
    return cachedResult
  }

  // ------- Outside markdown: basic Jig syntax -------

  test('L1: {{ className }} gets punctuation.mustache.begin', async ({ assert }) => {
    const result = await getResult()
    const token = getToken(result, 1, '{{')
    assert.isDefined(token, 'Expected {{ token on line 1')
    assert.isTrue(
      tokenHasAllScopes(token!, ['punctuation.mustache.begin', 'meta.embedded.block.javascript']),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenLacksAllScopes(token!, ['meta.embedded.block.markdown']),
      `Should not have markdown scope outside markdown block: ${formatScopes(token!)}`
    )
  })

  test('L3: @if outside markdown gets support.function.jig', async ({ assert }) => {
    const result = await getResult()
    const token = getToken(result, 3, '@if')
    assert.isDefined(token, 'Expected @if on line 3')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L17: {{-- comment --}} outside markdown gets comment.block', async ({ assert }) => {
    const result = await getResult()
    const token = getToken(result, 17, '{{--')
    assert.isDefined(token, 'Expected {{-- on line 17')
    assert.isTrue(
      tokenHasAllScopes(token!, ['comment.block', 'punctuation.definition.comment.begin.jig']),
      `Missing comment scopes: ${formatScopes(token!)}`
    )
  })

  test('L18: {{ escapedHtml }} outside markdown gets mustache scopes', async ({ assert }) => {
    const result = await getResult()
    const token = getToken(result, 18, '{{')
    assert.isDefined(token, 'Expected {{ on line 18')
    assert.isTrue(
      tokenHasAllScopes(token!, ['punctuation.mustache.begin', 'meta.embedded.block.javascript']),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
  })

  test('L19: {{{ unescapedHtml }}} outside markdown gets safe mustache scopes', async ({ assert }) => {
    const result = await getResult()
    const token = getToken(result, 19, '{{{')
    assert.isDefined(token, 'Expected {{{ on line 19')
    assert.isTrue(
      tokenHasAllScopes(token!, ['punctuation.mustache.begin', 'meta.embedded.block.javascript']),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
  })

  // ------- Markdown block boundaries -------

  test('L21: opening marker gets comment.block.jig', async ({ assert }) => {
    const result = await getResult()
    const tokens = getLineTokens(result, 21)
    // Leading whitespace + the marker
    const markerToken = tokens.find((t) => t.text.includes('{{--'))
    assert.isDefined(markerToken, 'Expected marker token on line 21')
    assert.isTrue(
      tokenHasScope(markerToken!, 'comment.block.jig'),
      `Missing comment.block.jig: ${formatScopes(markerToken!)}`
    )
  })

  test('L33: closing marker gets comment.block.jig, NOT meta.embedded.block.markdown', async ({
    assert,
  }) => {
    const result = await getResult()
    const tokens = getLineTokens(result, 33)
    const markerToken = tokens.find((t) => t.text.includes('{{--'))
    assert.isDefined(markerToken, 'Expected marker token on line 33')
    assert.isTrue(
      tokenHasScope(markerToken!, 'comment.block.jig'),
      `Missing comment.block.jig: ${formatScopes(markerToken!)}`
    )
    assert.isTrue(
      tokenLacksAllScopes(markerToken!, ['meta.embedded.block.markdown']),
      `Closing marker should not have meta.embedded.block.markdown: ${formatScopes(markerToken!)}`
    )
  })

  // ------- Inside markdown: Jig syntax must NOT be swallowed by host grammar -------

  test('L22: markdown heading gets markup.heading.markdown inside block', async ({ assert }) => {
    const result = await getResult()
    const token = getToken(result, 22, '#')
    assert.isDefined(token, 'Expected # on line 22')
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.markdown'),
      `Missing meta.embedded.block.markdown: ${formatScopes(token!)}`
    )
  })

  test('L26: @if inside markdown (after blank line) gets support.function.jig', async ({
    assert,
  }) => {
    const result = await getResult()
    const token = getToken(result, 26, '@if')
    assert.isDefined(token, 'Expected @if on line 26')
    assert.isTrue(
      tokenHasAllScopes(token!, ['support.function.jig', 'meta.embedded.block.markdown']),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
  })

  test('L29: @endif inside markdown (after blank line) gets support.function.jig', async ({
    assert,
  }) => {
    const result = await getResult()
    const token = getToken(result, 29, '@endif')
    assert.isDefined(token, 'Expected @endif on line 29')
    assert.isTrue(
      tokenHasAllScopes(token!, ['support.function.jig', 'meta.embedded.block.markdown']),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
  })

  test('L31: {{ dynamicContent }} inside markdown (after blank line) gets mustache scopes, NOT meta.paragraph', async ({
    assert,
  }) => {
    const result = await getResult()
    const token = getToken(result, 31, '{{')
    assert.isDefined(token, 'Expected {{ on line 31')
    assert.isTrue(
      tokenHasAllScopes(token!, [
        'punctuation.mustache.begin',
        'meta.embedded.block.javascript',
        'meta.embedded.block.markdown',
      ]),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenLacksAllScopes(token!, ['meta.paragraph.markdown']),
      `{{ must NOT be swallowed by meta.paragraph.markdown: ${formatScopes(token!)}`
    )
  })

  test('L31: dynamicContent body inside markdown gets meta.embedded.block.javascript', async ({
    assert,
  }) => {
    const result = await getResult()
    const token = getToken(result, 31, 'dynamicContent')
    assert.isDefined(token, 'Expected "dynamicContent" on line 31')
    assert.isTrue(
      tokenHasAllScopes(token!, [
        'meta.embedded.block.javascript',
        'meta.embedded.block.markdown',
      ]),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenLacksAllScopes(token!, ['meta.paragraph.markdown']),
      `Content must NOT be inside meta.paragraph.markdown: ${formatScopes(token!)}`
    )
  })

  test('L32: {{{ escapedDynamicContent }}} inside markdown (after {{ }}) gets safe mustache scopes', async ({
    assert,
  }) => {
    const result = await getResult()
    const token = getToken(result, 32, '{{{')
    assert.isDefined(token, 'Expected {{{ on line 32')
    assert.isTrue(
      tokenHasAllScopes(token!, [
        'punctuation.mustache.begin',
        'meta.embedded.block.javascript',
        'meta.embedded.block.markdown',
      ]),
      `Missing expected scopes: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenLacksAllScopes(token!, ['meta.paragraph.markdown']),
      `{{{ must NOT be swallowed by meta.paragraph.markdown: ${formatScopes(token!)}`
    )
  })

  // ------- After markdown block: no scope leakage -------

  test('L34: </div> after markdown block does NOT have meta.embedded.block.markdown', async ({
    assert,
  }) => {
    const result = await getResult()
    const tokens = getLineTokens(result, 34)
    assert.isTrue(tokens.length > 0, 'Expected tokens on line 34')
    for (const token of tokens) {
      assert.isTrue(
        tokenLacksAllScopes(token, ['meta.embedded.block.markdown']),
        `Content after markdown block should not have markdown scope: ${formatScopes(token)}`
      )
    }
  })
})

test.group('Grammar Scopes | Jig YAML grammar (text.jig.yaml)', () => {
  // Uses the real YAML grammar from VSCode (tests/fixtures/grammars/yaml*.json)
  // to verify Jig patterns take priority over YAML's greedy patterns.
  //
  // Fixture: examples/example.yml.jig
  //  0: # Example for jig-yaml
  //  1: name: {{ projectName }}
  //  2: version: {{ version }}
  //  3: @if(isEnabled)
  //  4: enabled: true
  //  5: @else
  //  6: enabled: false
  //  7: @end
  //  8: settings:
  //  9:   theme: {{ theme }}
  // 10:   features:
  // 11:     @each(feature in features)
  // 12:       - {{ feature }}
  // 13:     @end

  const yamlContent = fs.readFileSync(
    path.resolve(__dirname, '../examples/example.yml.jig'),
    'utf-8'
  )
  let cachedYamlResult: Awaited<ReturnType<typeof tokenizeContent>> | null = null
  async function getYamlResult() {
    if (!cachedYamlResult) {
      cachedYamlResult = await tokenizeContent('text.jig.yaml', yamlContent)
    }
    return cachedYamlResult
  }

  test('L0: # comment gets YAML comment scope', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 0, '#')
    assert.isDefined(token, 'Expected # on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'comment.line.number-sign.yaml'),
      `Missing YAML comment scope: ${formatScopes(token!)}`
    )
  })

  test('L1: {{ projectName }} gets punctuation.mustache.begin, not YAML flow mapping', async ({
    assert,
  }) => {
    const result = await getYamlResult()
    const token = getToken(result, 1, '{{')
    assert.isDefined(token, 'Expected {{ on line 1')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.mustache.begin'),
      `Missing punctuation.mustache.begin: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenLacksAllScopes(token!, ['punctuation.definition.mapping.begin.yaml']),
      `{{ must not be treated as YAML flow mapping: ${formatScopes(token!)}`
    )
  })

  test('L3: @if(isEnabled) gets support.function.jig', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 3, '@if')
    assert.isDefined(token, 'Expected @if on line 3')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L3: @if(isEnabled) opening paren gets punctuation.paren.open', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 3, '(')
    assert.isDefined(token, 'Expected ( on line 3')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.paren.open'),
      `Missing punctuation.paren.open: ${formatScopes(token!)}`
    )
  })

  test('L4: enabled: true gets YAML key/value scopes', async ({ assert }) => {
    const result = await getYamlResult()
    const keyToken = getToken(result, 4, 'enabled')
    assert.isDefined(keyToken, 'Expected "enabled" on line 4')
    assert.isTrue(
      tokenHasScope(keyToken!, 'entity.name.tag.yaml'),
      `Missing YAML key scope: ${formatScopes(keyToken!)}`
    )
  })

  test('L5: @else gets support.function.jig', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 5, '@else')
    assert.isDefined(token, 'Expected @else on line 5')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L7: @end gets support.function.jig', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 7, '@end')
    assert.isDefined(token, 'Expected @end on line 7')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L9: {{ theme }} inline after YAML key gets mustache scopes', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 9, '{{')
    assert.isDefined(token, 'Expected {{ on line 9')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.mustache.begin'),
      `Missing punctuation.mustache.begin: ${formatScopes(token!)}`
    )
  })

  test('L11: @each(feature in features) gets support.function.jig', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 11, '@each')
    assert.isDefined(token, 'Expected @each on line 11')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L12: {{ feature }} inside @each gets mustache scopes', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 12, '{{')
    assert.isDefined(token, 'Expected {{ on line 12')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.mustache.begin'),
      `Missing punctuation.mustache.begin: ${formatScopes(token!)}`
    )
  })

  test('L13: @end gets support.function.jig', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 13, '@end')
    assert.isDefined(token, 'Expected @end on line 13')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L14: {{-- :: markdown :: --}} gets comment.block.jig (embedded open marker)', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 14, '{{-- :: markdown :: --}}')
    assert.isDefined(token, 'Expected {{-- :: markdown :: --}} on line 14')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block.jig'),
      `Missing comment.block.jig: ${formatScopes(token!)}`
    )
  })

  test('L16: **bold** inside embedded markdown gets markup.bold scope', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 16, 'bold')
    assert.isDefined(token, 'Expected "bold" on line 16')
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.markdown'),
      `Missing meta.embedded.block.markdown: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'markup.bold.markdown'),
      `Missing markup.bold.markdown: ${formatScopes(token!)}`
    )
  })

  test('L17: {{ variable }} on own line inside embedded markdown gets Jig mustache scopes', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 17, '{{')
    assert.isDefined(token, 'Expected {{ on line 17')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.mustache.begin'),
      `Missing punctuation.mustache.begin: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.markdown'),
      `Missing meta.embedded.block.markdown: ${formatScopes(token!)}`
    )
  })

  test('L19: {{-- // markdown --}} gets comment.block.jig (embedded close marker)', async ({ assert }) => {
    const result = await getYamlResult()
    const token = getToken(result, 19, '{{-- // markdown --}}')
    assert.isDefined(token, 'Expected {{-- // markdown --}} on line 19')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block.jig'),
      `Missing comment.block.jig: ${formatScopes(token!)}`
    )
  })
})

// ---------------------------------------------------------------------------
// Jig TypeScript grammar (text.jig.ts)
// ---------------------------------------------------------------------------

test.group('Grammar Scopes | Jig TypeScript grammar (text.jig.ts)', () => {
  // File layout (0-indexed):
  //  0: import { Router } from 'express'
  //  1: const router = Router()
  //  2: @each(route in routes)
  //  3: router.{{ route.method }}('{{ route.path }}', async (req, res) => {
  //  4:   const data = {{ route.handler }}(req)
  //  5:   @if(route.authenticated)
  //  6:   if (!req.user) {
  //  7:     return res.status(401).json({ error: 'Unauthorized' })
  //  8:   }
  //  9:   @end
  // 10:   res.json(data)
  // 11: })
  // 12: @end
  // 13: {{-- :: markdown :: --}}
  // 14: # API Documentation
  // 15: This router handles **{{ routes.length }}** routes.
  // 16: - Supports authentication
  // 17: {{-- // markdown --}}
  // 18: export default router

  const tsContent = fs.readFileSync(
    path.resolve(__dirname, '../examples/example.ts.jig'),
    'utf-8'
  )
  let cachedTsResult: Awaited<ReturnType<typeof tokenizeContent>> | null = null
  async function getTsResult() {
    if (!cachedTsResult) {
      cachedTsResult = await tokenizeContent('text.jig.ts', tsContent.trimEnd())
    }
    return cachedTsResult
  }

  test('L0: import gets TypeScript keyword scope', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 0, 'import')
    assert.isDefined(token, 'Expected "import" on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'keyword.control.import.ts'),
      `Missing keyword.control.import.ts: ${formatScopes(token!)}`
    )
  })

  test('L1: const gets TypeScript storage.type scope', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 1, 'const')
    assert.isDefined(token, 'Expected "const" on line 1')
    assert.isTrue(
      tokenHasScope(token!, 'storage.type.ts'),
      `Missing storage.type.ts: ${formatScopes(token!)}`
    )
  })

  test('L2: @each at line start gets support.function.jig', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 2, '@each')
    assert.isDefined(token, 'Expected @each on line 2')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L3: {{ route.method }} gets mustache scopes', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 3, '{{')
    assert.isDefined(token, 'Expected {{ on line 3')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.mustache.begin'),
      `Missing punctuation.mustache.begin: ${formatScopes(token!)}`
    )
  })

  test('L12: @end at line start gets support.function.jig', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 12, '@end')
    assert.isDefined(token, 'Expected @end on line 12')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L13: {{-- :: markdown :: --}} gets comment.block.jig (embedded open marker)', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 13, '{{-- :: markdown :: --}}')
    assert.isDefined(token, 'Expected {{-- :: markdown :: --}} on line 13')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block.jig'),
      `Missing comment.block.jig: ${formatScopes(token!)}`
    )
  })

  test('L14: # API Documentation gets markdown heading scope', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 14, 'API Documentation')
    assert.isDefined(token, 'Expected "API Documentation" on line 14')
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.markdown'),
      `Missing meta.embedded.block.markdown: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'entity.name.section.markdown'),
      `Missing entity.name.section.markdown: ${formatScopes(token!)}`
    )
  })

  test('L15: **bold** inside embedded markdown gets markup.bold scope', async ({ assert }) => {
    const result = await getTsResult()
    // "{{ routes.length }}" is inside bold markers but eaten by markdown paragraph
    // Check the bold delimiters themselves
    const tokens = getTokens(result, 15, '**')
    assert.isTrue(tokens.length >= 2, 'Expected at least 2 ** tokens on line 15')
    assert.isTrue(
      tokenHasScope(tokens[0], 'markup.bold.markdown'),
      `Missing markup.bold.markdown: ${formatScopes(tokens[0])}`
    )
  })

  test('L17: {{-- // markdown --}} gets comment.block.jig (embedded close marker)', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 17, '{{-- // markdown --}}')
    assert.isDefined(token, 'Expected {{-- // markdown --}} on line 17')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block.jig'),
      `Missing comment.block.jig: ${formatScopes(token!)}`
    )
  })

  test('L18: export default after markdown block gets TypeScript scopes', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 18, 'export')
    assert.isDefined(token, 'Expected "export" on line 18')
    assert.isTrue(
      tokenHasScope(token!, 'keyword.control.export.ts'),
      `Missing keyword.control.export.ts: ${formatScopes(token!)}`
    )
  })

  test('L18: TypeScript resumes after embedded markdown block closes', async ({ assert }) => {
    const result = await getTsResult()
    const token = getToken(result, 18, 'router')
    assert.isDefined(token, 'Expected "router" on line 18')
    // Should NOT have markdown scope
    assert.isTrue(
      tokenLacksAllScopes(token!, ['meta.embedded.block.markdown']),
      `Should not have markdown scope after block closes: ${formatScopes(token!)}`
    )
  })
})

// ---------------------------------------------------------------------------
// Jig Markdown grammar (text.jig.markdown)
// ---------------------------------------------------------------------------

test.group('Grammar Scopes | Jig Markdown grammar (text.jig.markdown)', () => {
  // File layout (0-indexed):
  //  0: # {{ title }}
  //  1: (empty)
  //  2: This is a **Jig** markdown template.
  //  3: (empty)
  //  4: This router handles {{ routes.length }} **routes**.
  //  5: (empty)
  //  6: @if(showBanner)
  //  7: ![Banner]({{ bannerUrl }})
  //  8: @end
  //  9: (empty)
  // 10: ## Features
  // 11: (empty)
  // 12: @each(feature in features)
  // 13: - **{{ feature.name }}**: {{ feature.description }}
  // 14: @end
  // 15: (empty)
  // 16: {{-- Jig comment --}}
  // 17: (empty)
  // 18: > Quote: {{{ rawQuote }}}
  // 19: (empty)
  // 20: {{-- :: ts :: --}}
  // 21: interface Route {
  // 22:   path: string
  // 23:   method: 'GET' | 'POST'
  // 24: }
  // 25: (empty)
  // 26: const routes: Route[] = []
  // 27: {{-- // ts --}}
  // 28: (empty)
  // 29: ## Footer
  // 30: Made by {{ author }}

  const mdContent = fs.readFileSync(
    path.resolve(__dirname, '../examples/example.md.jig'),
    'utf-8'
  )
  let cachedMdResult: Awaited<ReturnType<typeof tokenizeContent>> | null = null
  async function getMdResult() {
    if (!cachedMdResult) {
      cachedMdResult = await tokenizeContent('text.jig.markdown', mdContent.trimEnd())
    }
    return cachedMdResult
  }

  test('L0: # heading gets markdown heading scope', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 0, '#')
    assert.isDefined(token, 'Expected # on line 0')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.definition.heading.markdown'),
      `Missing heading punctuation scope: ${formatScopes(token!)}`
    )
  })

  test('L2: **Jig** gets markup.bold.markdown', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 2, 'Jig')
    assert.isDefined(token, 'Expected "Jig" on line 2')
    assert.isTrue(
      tokenHasScope(token!, 'markup.bold.markdown'),
      `Missing markup.bold.markdown: ${formatScopes(token!)}`
    )
  })

  test('L6: @if(showBanner) gets support.function.jig', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 6, '@if')
    assert.isDefined(token, 'Expected @if on line 6')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L8: @end gets support.function.jig', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 8, '@end')
    assert.isDefined(token, 'Expected @end on line 8')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L10: ## Features gets markdown heading scope', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 10, 'Features')
    assert.isDefined(token, 'Expected "Features" on line 10')
    assert.isTrue(
      tokenHasScope(token!, 'entity.name.section.markdown'),
      `Missing entity.name.section.markdown: ${formatScopes(token!)}`
    )
  })

  test('L12: @each(feature in features) gets support.function.jig', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 12, '@each')
    assert.isDefined(token, 'Expected @each on line 12')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L13: - list item gets markdown list scope', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 13, '-')
    assert.isDefined(token, 'Expected "-" on line 13')
    assert.isTrue(
      tokenHasScope(token!, 'punctuation.definition.list.begin.markdown'),
      `Missing markdown list scope: ${formatScopes(token!)}`
    )
  })

  test('L14: @end gets support.function.jig', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 14, '@end')
    assert.isDefined(token, 'Expected @end on line 14')
    assert.isTrue(
      tokenHasScope(token!, 'support.function.jig'),
      `Missing support.function.jig: ${formatScopes(token!)}`
    )
  })

  test('L16: {{-- Jig comment --}} gets comment.block scope', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 16, '{{--')
    assert.isDefined(token, 'Expected {{-- on line 16')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block'),
      `Missing comment.block: ${formatScopes(token!)}`
    )
  })

  test('L20: {{-- :: ts :: --}} gets comment.block.jig (embedded open marker)', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 20, '{{-- :: ts :: --}}')
    assert.isDefined(token, 'Expected {{-- :: ts :: --}} on line 20')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block.jig'),
      `Missing comment.block.jig: ${formatScopes(token!)}`
    )
  })

  test('L21: interface gets TypeScript keyword inside embedded TS block', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 21, 'interface')
    assert.isDefined(token, 'Expected "interface" on line 21')
    assert.isTrue(
      tokenHasScope(token!, 'storage.type.interface.ts'),
      `Missing storage.type.interface.ts: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.ts'),
      `Missing meta.embedded.block.ts: ${formatScopes(token!)}`
    )
  })

  test('L22: path: string gets TypeScript type annotation inside embedded TS block', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 22, 'string')
    assert.isDefined(token, 'Expected "string" on line 22')
    assert.isTrue(
      tokenHasScope(token!, 'support.type.primitive.ts'),
      `Missing support.type.primitive.ts: ${formatScopes(token!)}`
    )
  })

  test('L26: const gets TypeScript storage.type inside embedded TS block', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 26, 'const')
    assert.isDefined(token, 'Expected "const" on line 26')
    assert.isTrue(
      tokenHasScope(token!, 'storage.type.ts'),
      `Missing storage.type.ts: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenHasScope(token!, 'meta.embedded.block.ts'),
      `Missing meta.embedded.block.ts: ${formatScopes(token!)}`
    )
  })

  test('L27: {{-- // ts --}} gets comment.block.jig (embedded close marker)', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 27, '{{-- // ts --}}')
    assert.isDefined(token, 'Expected {{-- // ts --}} on line 27')
    assert.isTrue(
      tokenHasScope(token!, 'comment.block.jig'),
      `Missing comment.block.jig: ${formatScopes(token!)}`
    )
  })

  test('L29: ## Footer — markdown resumes after embedded TS block', async ({ assert }) => {
    const result = await getMdResult()
    const token = getToken(result, 29, 'Footer')
    assert.isDefined(token, 'Expected "Footer" on line 29')
    assert.isTrue(
      tokenHasScope(token!, 'entity.name.section.markdown'),
      `Missing entity.name.section.markdown: ${formatScopes(token!)}`
    )
    assert.isTrue(
      tokenLacksAllScopes(token!, ['meta.embedded.block.ts']),
      `Should not have TS embedded scope after block closes: ${formatScopes(token!)}`
    )
  })
})

test.group('Grammar Scopes | Regression — no double-matching', () => {
  test('inside {{ }}, content does NOT get comment.block or comment.block.jig', async ({
    assert,
  }) => {
    const result = await tokenizeContent('source.jig.html', '{{ someExpression }}')
    const content = getToken(result, 0, 'someExpression')
    assert.isDefined(content, 'Expected "someExpression" token on line 0')
    assert.isTrue(
      tokenHasScope(content!, 'meta.embedded.block.javascript'),
      `Missing meta.embedded.block.javascript: ${formatScopes(content!)}`
    )
    assert.isTrue(
      tokenLacksAllScopes(content!, ['comment.block', 'comment.block.jig']),
      `Content inside mustache should not have comment scope: ${formatScopes(content!)}`
    )
  })

  test('inside {{-- --}}, ALL tokens have comment.block', async ({ assert }) => {
    const result = await tokenizeContent('source.jig.html', '{{-- some content --}}')
    const tokens = getLineTokens(result, 0)
    for (const token of tokens) {
      assert.isTrue(
        tokenHasScope(token, 'comment.block'),
        `Token should be inside comment.block: ${formatScopes(token)}`
      )
    }
  })

  test('comment.block (not comment.block.jig) is used for regular comments', async ({
    assert,
  }) => {
    const result = await tokenizeContent('source.jig.html', '{{-- text --}}')
    const inner = getToken(result, 0, ' text ')
    assert.isDefined(inner, 'Expected inner text token on line 0')
    // Regular comments use comment.block (without .jig suffix)
    assert.isTrue(
      tokenHasScope(inner!, 'comment.block'),
      `Missing comment.block: ${formatScopes(inner!)}`
    )
    // comment.block.jig is used by embedded language markers, not regular comments
    assert.isTrue(
      tokenLacksAllScopes(inner!, ['comment.block.jig']),
      `Regular comment inner text should not have comment.block.jig: ${formatScopes(inner!)}`
    )
  })
})
