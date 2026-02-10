import { type ExtensionContext, RelativePattern, type Uri, languages, workspace } from 'vscode'
import { IndexerManager } from './indexer_manager'
import { ExtConfig } from './config'
import { Logger } from './logger'
import { TsCompletionProvider } from './providers/ts_completions'
import { JigCompletionProvider } from './providers/jig_completions'
import { JigLinksProvider } from './providers/jig_links'
import { TsLinksProvider } from './providers/ts_links'

export async function activate(context: ExtensionContext) {
  /**
   * Re-index projects when a new .jig file has been created/deleted
   */
  const watcherPattern = new RelativePattern(workspace.workspaceFolders![0]!, '**/*.{jig}')
  const watcher = workspace.createFileSystemWatcher(watcherPattern)
  async function reIndex(file: Uri) {
    Logger.info(`File changed: ${file.fsPath}`)
    const indexer = IndexerManager.getIndexerFromFile(file.fsPath)
    if (!indexer) return

    const res = await indexer.scan()
    Logger.info(`Found ${res.length} templates`)
  }

  watcher.onDidCreate(reIndex)
  watcher.onDidDelete(reIndex)
  watcher.onDidChange(reIndex)

  /**
   * Re-bootstrap and index projects when the configuration changes
   */
  ExtConfig.onDidChange(
    async () => {
      Logger.info('Configuration changed, re-indexing projects')
      await IndexerManager.bootstrap()
    },
    { immediate: true }
  )

  const jigSelector = [{ language: 'jig', scheme: 'file' }]
  const jsSelectors = [
    { language: 'javascript', scheme: 'file' },
    { language: 'typescript', scheme: 'file' },
  ]

  /**
   * Autocompletion and links for views in TS files
   */
  const viewsTsLink = languages.registerDocumentLinkProvider(jsSelectors, new TsLinksProvider())
  const viewsCompletion = languages.registerCompletionItemProvider(
    jsSelectors,
    new TsCompletionProvider(),
    '"',
    "'"
  )

  /**
   * Autocompletion and links for views in Jig files
   */
  const jigLinks = languages.registerDocumentLinkProvider(jigSelector, new JigLinksProvider())
  const jigCompletion = languages.registerCompletionItemProvider(
    jigSelector,
    new JigCompletionProvider(),
    '@',
    '!'
  )

  context.subscriptions.push(viewsCompletion, viewsTsLink, jigCompletion, jigLinks)
}
