const fs = require('fs')
const t = fs.readFileSync('.env', 'utf8')
const m = t.match(/^OPENAI_API_KEY=(.*)$/m)
const v = (m && m[1] ? m[1] : '').trim().replace(/^["']|["']$/g, '')
const ok =
  v.startsWith('sk-') &&
  v.length > 20 &&
  !/your-key|changeme|example|placeholder/i.test(v)
console.log(ok ? 'API_KEY_OK' : 'API_KEY_MISSING_OR_PLACEHOLDER')
const mm = t.match(/^OPENAI_MODEL=(.*)$/m)
const model = (mm && mm[1] ? mm[1] : 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
console.log('MODEL=' + model)
