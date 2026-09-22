/**
 * Lightweight query extraction (kept separate so resolve stays focused).
 */
export function extractSearchQueries(instruction: string): string[] {
  const text = instruction.trim()
  const queries: string[] = []

  const patterns = [
    /(?:where(?:'s| is)|find|point(?:\s+to|\s+at)?|show(?:\s+me)?|click|open|highlight)\s+(?:the\s+)?(.+?)(?:\s+icon|\s+button|\s+app|\s+shortcut)?[.?!]?$/i,
    /(?:point|show|find)\s+(?:me\s+)?(?:where\s+)?(.+)/i
  ]

  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      queries.push(
        m[1]
          .replace(/\b(on (my )?screen|please|now)\b/gi, '')
          .replace(/\b(icon|button|app|shortcut|program)\b/gi, '')
          .trim()
      )
    }
  }

  const cleaned = text
    .replace(
      /\b(where|is|are|the|a|an|my|please|can|you|find|point|to|at|show|me|click|open|highlight)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned) queries.push(cleaned)

  return [...new Set(queries.map((q) => q.trim()).filter((q) => q.length >= 2))]
}
