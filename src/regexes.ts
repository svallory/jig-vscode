/**
 * Find all the views that are being used inside an Jig template
 */
export const jigRegex = /(@include|@!?component)\(['"]([^'"]+)['"]/g

/**
 * Find all components as tags inside an Jig template
 */
export const jigComponentsAsTagsRegex =
  /^[ \t]*(@!?(?!include|includeIf|set|can|unless|svg|let|eval|inject|stack|dd|dump|pushTo|pushOnceTo|!component|if|elseif|else|vite|entryPointScripts|entryPointStyles|each|assign|debugger|component|slot|newError)(.+?))\(.*/gm

/**
 * Find all the views that are being used inside a TS/Js file
 */
export const tsRegex = /((?:[Vv]iew|[Jj]ig)\.render(?:Sync)?\(['"](.*?)['"])/g

/**
 * Check if we are currently inside a view link and capture the user input to suggest completions
 */
export const viewsCompletionRegex = /(?<=@include\(['"]|@layout\(['"]|@!component\(['"])[^'"]*/g

/**
 * Check if we are currently inside a component as tag and capture the user input
 * to suggest completions
 */
export const jigComponentsAsTagsCompletionRegex =
  /@!?(?!include|includeIf|set|can|unless|svg|let|eval|inject|stack|dd|dump|pushTo|pushOnceTo|!component|if|elseif|else|vite|entryPointScripts|entryPointStyles|each|assign|debugger|component|slot|newError)(.+)?\(?/g

/**
 * Check if we are currently inside a view link and capture the user input to suggest completions
 */
export const tsViewsCompletionRegex = /(?<=([Jj]ig|[Vv]iew)\.render(?:Sync)?\()(['"])[^'"]*\2/g
