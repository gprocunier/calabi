import { codeToHtml } from 'shiki'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin)
    chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function highlightBlock({ code, language }, theme, fallbackLanguage) {
  let finalLanguage = language || fallbackLanguage

  try {
    const html = await codeToHtml(code, {
      lang: finalLanguage,
      theme,
    })
    return { html, language: finalLanguage }
  }
  catch (error) {
    if (finalLanguage !== fallbackLanguage) {
      const html = await codeToHtml(code, {
        lang: fallbackLanguage,
        theme,
      })
      return {
        html,
        language: fallbackLanguage,
        warning: String(error),
      }
    }

    const html = await codeToHtml(code, {
      lang: 'text',
      theme,
    })
    return {
      html,
      language: 'text',
      warning: String(error),
    }
  }
}

async function main() {
  const raw = await readStdin()
  const payload = JSON.parse(raw || '{}')
  const theme = payload.theme || 'github-dark-high-contrast'
  const fallbackLanguage = payload.fallbackLanguage || 'bash'
  const blocks = payload.blocks || []

  const results = []
  for (const block of blocks)
    results.push(await highlightBlock(block, theme, fallbackLanguage))

  process.stdout.write(JSON.stringify(results))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
