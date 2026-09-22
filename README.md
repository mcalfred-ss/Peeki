# Peeki

Windows-first PC AI assistant that sees your screen, explains what’s happening, and guides the next step. Computer control is architected but stubbed until you enable it.

## Architecture (modular monolith)

One Electron app. Clear internal modules. No microservices.

See **[ROADMAP.md](./ROADMAP.md)** for the 14 feature checklist (highlights, step mode, voice, privacy, computer use, and more).

```text
User → Renderer (UI)
         ↕ IPC
       Main (composition root)
         → capture  → screenshot
         → ai       → vision API
         → agent    → orchestrates the loop
         → permissions → confirmation rules
         → actions  → stub executor (future click/type/scroll)
```

| Module | Role |
|---|---|
| `modules/shared` | Contracts & IPC channel names |
| `modules/capture` | Screen capture |
| `modules/ai` | Vision/reasoning API client |
| `modules/agent` | Capture → AI → decision |
| `modules/permissions` | Confirmation / allow rules |
| `modules/actions` | Computer control (stub) |
| `modules/overlay` | Floating eye placement rules |

Modules depend on **shared contracts**, not on each other’s internals. The main process is the only composition root.

## Setup

```bash
cp .env.example .env
# put your OpenAI key in .env
npm install
npm run dev
```

## Scripts

- `npm run dev` — run the desktop app
- `npm run build` — compile
- `npm run typecheck` — TypeScript checks
- `npm run dist` — Windows installer (after build)

## Session memory

Peeki keeps the last **5 turns** of text memory in this session (instruction + what it saw + guidance).  
Follow-ups like “now what?” or “click the next one” use that context. Old screenshots are **not** stored.

- Ask bar shows **Memory N**
- Click it to clear memory and start fresh
- Memory resets when you quit Peeki (not saved to disk yet)


1. Put a real key in `.env`: `OPENAI_API_KEY=sk-...` and keep `OPENAI_MODEL=gpt-4.1-mini`
2. Run **one** session only: `npm.cmd run dev`
3. Open the app you want help with (not Peeki) in the foreground
4. Click the floating eye → ask at the bottom → Enter
5. Peeki briefly hides itself, captures the real screen, then answers

Peeki will not capture its own eye/ask bar/main window, so the model sees your work — not Peeki.


While Peeki is running, a small always-on-top logo sits on your desktop (default: bottom-left).

- **Drag** to reposition (saved for next launch)
- **Click** to open the centered Ask bar
- Toggle **Show floating eye** in the composer row
- Esc or click outside the Ask bar to dismiss

## MVP behavior

1. Capture the primary display
2. Send screenshot + instruction to the vision model
3. Return structured guidance (`screenSummary`, `guidance`, `nextStep`, …)
4. Optionally propose actions (off by default)
5. Any proposed action requires explicit confirmation; execution is still a stub

## Security defaults

- API key stays in the main process (never in the renderer)
- Screen is captured only when you ask
- No computer action runs without confirmation
- Action executor is disabled (`enabled: false`) until you implement OS automation
