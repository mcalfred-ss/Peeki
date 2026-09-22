/**
 * Detect asks that need precise on-screen pointing (OCR + map worth the latency).
 * Also classify inventory, progress ("I did that"), and bare labels.
 */

export function isInventoryRequest(instruction: string): boolean {
  const t = instruction.trim().toLowerCase()
  if (!t) return false

  if (/\b(how many|count|list|enumerate)\b/.test(t) && /\b(apps?|icons?|shortcuts?|programs?|applications?)\b/.test(t)) {
    return true
  }
  if (/\b(what|which)\b/.test(t) && /\b(apps?|icons?|shortcuts?|programs?|applications?)\b/.test(t)) {
    return true
  }
  if (/\b(apps?|programs?)\b.{0,20}\b(have|installed|on (my |the )?(desktop|screen))\b/.test(t)) {
    return true
  }
  if (/\b(what('?s| is) on (my |the )?desktop)\b/.test(t)) return true
  if (/\b(show|tell) me (all |the )?(apps?|icons?|programs?)\b/.test(t)) return true
  return false
}

/** Open-ended help on the current screen (design, edit, how-to) — not locate. */
export function isCoachingRequest(instruction: string): boolean {
  const t = instruction.trim().toLowerCase()
  if (!t) return false
  if (isInventoryRequest(instruction) || isProgressRequest(instruction)) return false
  // Explicit locate verbs win over coaching
  if (/\b(where is|where's|point to|point at|find the|show me where)\b/.test(t)) return false
  if (/\b(open|launch|click)\s+(?:the\s+)?[a-z0-9]/i.test(t) && !/\bhelp\b/.test(t)) {
    return false
  }

  if (/\b(help me|help with|how (do|can|should) i|how to|teach me|guide me|walk me)\b/.test(t)) {
    return true
  }
  if (/\b(what should i|improve|redesign|design|draw|edit|create|make|fix|build|style)\b/.test(t)) {
    return true
  }
  if (/^help\b/.test(t)) return true
  return false
}

/** User finished a tip and wants the next one — not a locate request. */
export function isProgressRequest(instruction: string): boolean {
  const t = instruction.trim().toLowerCase()
  if (!t) return false

  if (
    /^(ok|okay|yes|yep|yeah|done|next|continue|go on|keep going|thanks|thank you)[.!]?$/i.test(t)
  ) {
    return true
  }
  if (
    /\b(i (?:'?ve |have )?(?:did|done|finished)|did that|done that|that'?s done|finished that|i'?m done)\b/.test(
      t
    )
  ) {
    return true
  }
  if (/\b(what'?s next|whats next|next step|keep going|go on|continue)\b/.test(t)) {
    return true
  }
  if (/^(and then|then what)\b/.test(t)) return true
  return false
}

export function isPointingRequest(instruction: string): boolean {
  const t = instruction.trim().toLowerCase()
  if (!t) return false

  if (isInventoryRequest(instruction)) return false
  if (isProgressRequest(instruction)) return false
  // Open-ended help is coaching, not "find an app"
  if (isCoachingRequest(instruction)) return false

  if (/\b(point to|point at|where is|where's|show me where|highlight|find the)\b/.test(t)) {
    return true
  }

  // "find Photoshop" / "show Telegram" / "locate Chrome"
  if (/\b(find|show|locate)\s+(?:me\s+)?(?:the\s+)?[a-z0-9]/i.test(t)) {
    return true
  }

  // "open Telegram" / "launch Chrome" / "click Recycle Bin"
  if (/\b(open|launch|start|click)\s+(?:the\s+)?[a-z0-9]/i.test(t)) {
    return true
  }

  const verbs =
    /\b(point|highlight|show|find|where|locate|click|open|tap|select|mark|launch|start)\b/.test(t)
  const targets =
    /\b(icon|button|app|shortcut|taskbar|search|bar|settings|desktop|tab|menu|window)\b/.test(t) ||
    /\b(where('?s| is)|show me|point to|point at|find me)\b/.test(t)

  if (verbs && targets) return true
  if (/\b(where should i click|what should i click)\b/.test(t)) return true

  if (isBareTargetLabel(instruction.trim())) return true
  return false
}

/** "Git Bash", "telegram", "Adobe Photoshop" — not "continue" or "i did that". */
export function isBareTargetLabel(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 48) return false
  if (/[?!]/.test(trimmed)) return false
  if (
    /\b(what|where|how|why|when|which|who|count|list|please|have|here|screen|show|find|open|click|continue|next|done|did|that|this|okay|ok|yes|yeah|thanks|thank|keep|going|step|help|me|i|im|i'm)\b/i.test(
      trimmed
    )
  ) {
    return false
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length < 1 || tokens.length > 3) return false
  return /^[a-z0-9][a-z0-9 .+\-]*$/i.test(trimmed)
}

export type PointingHint =
  | 'desktop-icon'
  | 'taskbar'
  | 'window'
  | 'search-field'
  | 'button'
  | 'text-on-page'
  | 'generic'

/** What kind of thing the user is asking for. */
export type UserTargetIntent =
  | 'app-icon'
  | 'text-on-page'
  | 'ui-control'
  | 'search-field'
  | 'inventory'
  | 'progress'
  | 'coaching'
  | 'generic'

export type TargetCategory =
  | 'desktop-icon'
  | 'taskbar'
  | 'application'
  | 'button'
  | 'text'
  | 'input'
  | 'link'
  | 'image'
  | 'window'
  | 'unknown'

export function inferUserTargetIntent(instruction: string): UserTargetIntent {
  const t = instruction.toLowerCase()

  if (isProgressRequest(instruction)) return 'progress'
  if (isInventoryRequest(instruction)) return 'inventory'
  if (isCoachingRequest(instruction)) return 'coaching'

  if (
    /\b(word|text|string|label)\b/.test(t) ||
    /\bon (this |the )?(page|webpage|website|document|pdf)\b/.test(t) ||
    /\b(find|search for|look for) the word\b/.test(t) ||
    /\bocr\b/.test(t)
  ) {
    return 'text-on-page'
  }

  if (/\b(search\s*bar|address\s*bar|url\s*bar|omnibox|google search|type in)\b/.test(t)) {
    return 'search-field'
  }

  if (/\b(button|link|menu item|checkbox|toggle)\b/.test(t)) {
    return 'ui-control'
  }

  if (
    /\b(show|open|launch|start|click|point|where|find|highlight|icon|shortcut|app|program|desktop)\b/.test(
      t
    )
  ) {
    return 'app-icon'
  }

  if (isBareTargetLabel(instruction.trim())) {
    return 'app-icon'
  }

  return 'generic'
}

export function inferPointingHint(instruction: string): PointingHint {
  const intent = inferUserTargetIntent(instruction)
  switch (intent) {
    case 'text-on-page':
      return 'text-on-page'
    case 'search-field':
      return 'search-field'
    case 'ui-control':
      return 'button'
    case 'app-icon':
      return 'desktop-icon'
    case 'inventory':
    case 'progress':
    case 'coaching':
      return 'generic'
    case 'generic': {
      const t = instruction.toLowerCase()
      if (/\b(taskbar|pinned)\b/.test(t)) return 'taskbar'
      if (/\b(window)\b/.test(t)) return 'window'
      return 'generic'
    }
    default: {
      const _exhaustive: never = intent
      return _exhaustive
    }
  }
}

export function categorizeElement(el: {
  source: string
  role?: string
}): TargetCategory {
  const role = (el.role || '').toLowerCase()
  const source = el.source

  if (source === 'desktop' || role === 'desktopicon') return 'desktop-icon'
  if (source === 'taskbar' || role === 'taskbarbutton') return 'taskbar'
  if (source === 'ocr' || role === 'text') return 'text'
  if (role === 'window') return 'window'
  if (/edit|document|combo|spinner/.test(role)) return 'input'
  if (/hyperlink|link/.test(role)) return 'link'
  if (/button|menuitem/.test(role)) return 'button'
  if (/image/.test(role)) return 'image'
  if (source === 'uia' && role === 'window') return 'application'
  if (source === 'uia') return 'application'
  return 'unknown'
}
