# Peeki Product Roadmap

Living checklist of features that make Peeki more useful and delightful.  
Work top-down when possible; reorder if user demand says otherwise.

**Status key:** `todo` · `in_progress` · `done` · `blocked`

---

## Near-term (high love / fits Peeki now)

### 1. On-screen coach marks
- **Status:** `done`
- **Idea:** Highlight the button/area to click with a glow ring + short label (e.g. “Click Export”).
- **Why:** Instant magic — the killer demo moment.
- **Notes:** AI returns normalized highlight boxes → full-screen transparent overlay paints glow marks. Hidden during capture. Auto-hides in normal mode; follows steps in step mode.
- **Depends on:** Capture + agent decision schema
- **Owner / next step:** Improve targeting accuracy; optional click-through polish

### 2. Step mode
- **Status:** `done`
- **Idea:** “Do one step → I watch → then next.” Peeki waits until the screen changes, then continues.
- **Why:** Feels like a human tutor, not a wall of instructions.
- **Notes:** Ask-bar **Step** toggle. AI returns `steps[]`; UI walks Back/Next/Done and updates matching highlights. Screen-change auto-advance still future work.
- **Depends on:** Session memory, capture loop
- **Owner / next step:** Auto-advance when screen changes (diff)

### 3. Voice ask + voice reply
- **Status:** `done`
- **Idea:** Click eye → talk → hear the next step.
- **Why:** Hands-free while working is addictive.
- **Notes:** Ask-bar **Voice** uses Web Speech API (STT). Guidance/next step spoken via `speechSynthesis` when enabled.
- **Depends on:** Ask bar UX
- **Owner / next step:** Toggle for voice reply in settings UI; better mic permission UX

### 4. “Watch with me” mode
- **Status:** `done`
- **Idea:** Light continuous awareness (every few seconds, only when enabled).
- **Why:** Peeki can nudge (“you’re in the wrong dialog”) without reopening the ask bar.
- **Notes:** Right-click floating eye → **Watch with me**. Checks ~every 15s only when screen changes. Eye shows teal pulse while watching. Cost-aware (skips unchanged screens / quiet nudges).
- **Depends on:** Capture, privacy defaults, cost controls
- **Owner / next step:** Tune sensitivity; optional tray badge

### 5. Teach me this app
- **Status:** `done`
- **Idea:** One-tap: “Explain this screen” / “What’s safe to click?”
- **Why:** Great for Excel, Settings, browsers, installers.
- **Notes:** Ask-bar **+** opens presets: Explain / Safe clicks / Next step.
- **Depends on:** Ask bar
- **Owner / next step:** Add more presets per app later

---

## Medium-term (makes it sticky)

### 6. Saved skills / macros
- **Status:** `done`
- **Idea:** “Remember how I export this report.” Next time: one click to replay the guided path.
- **Why:** Turns one-off help into personal superpowers.
- **Notes:** Ask-bar **+ → Skills**. Save after an answer; replay opens step coach + highlights. Stored in `userData/skills.json`.
- **Depends on:** Memory, step mode, highlights
- **Owner / next step:** Optional auto-name from app; action replay later

### 7. Privacy zones
- **Status:** `done`
- **Idea:** Auto-blur passwords, banking, chat before sending screenshots.
- **Why:** People won’t use a screen AI without this.
- **Notes:** Ask-bar **Privacy** toggle blurs default zones (taskbar, notifications, sign-in band) before AI. Custom zones later.
- **Depends on:** Capture pipeline
- **Owner / next step:** User-drawn privacy regions + smarter detection

### 8. Team / family profiles
- **Status:** `todo`
- **Idea:** “Beginner mode” vs “power user” (more shortcuts, fewer hand-holds).
- **Why:** Same product works for different people.
- **Notes:** Profile affects prompt tone, step length, and whether actions are proposed.
- **Depends on:** Settings, prompts
- **Owner / next step:** Add `userProfile` to settings + prompt variants

### 9. Undo / safety net
- **Status:** `done`
- **Idea:** Before risky actions: “This closes without saving — confirm?”
- **Why:** Builds trust for computer-control later.
- **Notes:** Ask-bar safety panel lists each proposed action with risk badge + short risk note. Cancel / Run gate before any computer control. High-risk multi-action batches blocked in executor.
- **Depends on:** Permissions, action executor
- **Owner / next step:** Richer risk copy + undo history later

### 10. History timeline
- **Status:** `done`
- **Idea:** “What did we do in the last 10 minutes?” with screenshots + steps.
- **Why:** Useful and shareable.
- **Notes:** Ask-bar **+ → History**. Text-only local log in `userData/history.json` (no screenshots yet). Re-ask from an entry.
- **Depends on:** Memory module evolution, optional disk persist
- **Owner / next step:** Optional blurred thumbnails later

---

## Bigger differentiators (later)

### 11. True computer use (click / type / scroll)
- **Status:** `done` *(v1 — confirmed actions only)*
- **Idea:** Peeki performs actions with user confirmation.
- **Why:** Becomes a real assistant, not only a coach.
- **Notes:** Toggle **Act on** in ask bar (and Computer control in eye menu). AI may propose click/type/hotkey/scroll with coords. Runs via Windows user32/SendKeys only after safety confirm. Peeki UI hides during execution.
- **Depends on:** Highlights (for targeting), permissions, safety net
- **Owner / next step:** Better targeting accuracy; open_app; accessibility-tree fallback

### 12. Multi-monitor smart focus
- **Status:** `todo`
- **Idea:** Follow the cursor / active window across monitors.
- **Why:** Real Windows setups are multi-display.
- **Notes:** Capture focused display; eye can stay on primary or follow.
- **Depends on:** Capture module
- **Owner / next step:** Display picker + “capture active display” option

### 13. Plugins (Chrome / VS Code / Excel, etc.)
- **Status:** `todo`
- **Idea:** Deeper hooks per app for better targeting and safer actions.
- **Why:** Generic vision is good; app-aware is great.
- **Notes:** Keep core modular; plugins register tools / context providers.
- **Depends on:** Stable agent + action interfaces
- **Owner / next step:** Define plugin interface in `modules/` after computer-use v1

### 14. Share a Peeki session
- **Status:** `todo`
- **Idea:** Send someone a guided replay of how to fix something.
- **Why:** Help friends/family/coworkers — viral loop.
- **Notes:** Export anonymized step list + optional blurred screenshots. Privacy first.
- **Depends on:** History timeline, privacy zones
- **Owner / next step:** Export “guided replay” file / link after history exists

---

## Suggested build order

| Order | Feature | Why this order |
|------:|---------|----------------|
| 1 | On-screen coach marks (#1) | Visual wow, unlocks better coaching |
| 2 | Step mode (#2) | Natural next after highlights |
| 3 | Privacy zones (#7) | Trust before more screen sharing |
| 4 | Voice (#3) | Premium feel, still guidance-only |
| 5 | Teach me this app (#5) | Easy presets, high daily use |
| 6 | Watch with me (#4) | Needs cost + privacy discipline |
| 7 | Safety net (#9) | Required before real actions |
| 8 | Computer use (#11) | Big leap; confirmation + real executor |
| 9 | Skills / macros (#6) | Strong once steps + actions exist |
| 10 | History timeline (#10) | Persistence + review |
| 11 | Multi-monitor (#12) | Power-user polish |
| 12 | Profiles (#8) | Personalization layer |
| 13 | Plugins (#13) | Scale depth per app |
| 14 | Share session (#14) | Growth after history + privacy |

---

## Already shipped (foundation)

Keep this list honest as we go:

- [x] Screen capture → vision API → guidance
- [x] Floating eye + bottom ask bar
- [x] Session short-term memory (last 5 text turns)
- [x] Hide Peeki UI during capture
- [x] Action schema + confirmation gate + real executor (click/type/scroll/hotkey)
- [x] Single-instance lock / modular monolith
- [x] On-screen coach marks (#1)
- [x] Step mode (#2)
- [x] Voice ask + reply (#3)
- [x] Watch with me (#4)
- [x] Teach me presets (#5)
- [x] Privacy blur zones (#7)
- [x] Safety net confirm UI (#9)
- [x] Basic computer use (#11)
- [x] Saved skills / macros (#6)
- [x] History timeline — text log (#10)

---

## How we use this file

1. Pick the next `todo` item (usually from **Suggested build order**).
2. Set it to `in_progress` while building.
3. Mark `done` when usable in the app (not just designed).
4. Add short notes under **Owner / next step** when we learn something.
5. Do not expand scope mid-item — finish one slice, then move on.
