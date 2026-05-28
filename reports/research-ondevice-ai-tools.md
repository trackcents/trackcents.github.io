# On-device "smart" tooling — research landscape (2026-05-27)

Brainstorm research for making the app friendlier / smarter while honoring the
constitution: **on-device, privacy-first (nothing leaves the device), $0/month,
offline, must work on iPhone + Android + desktop.** Personas are archetypes
(Bhargav = manual-only, INR; Murali = upload+manual, USD) — design for the
classes, not the two names.

## Hard rules that frame every choice

- **No cloud LLM / no third-party API for user financial data** — breaks privacy,
  $0, offline, and the constitution. (Cheap APIs like Groq/DeepInfra ≈ pennies/mo
  but the text leaves the device → rejected.)
- **No self-hosted LLM** — a 24/7 cloud GPU is ~$1,400–1,800/mo; only pays off
  above ~11B tokens/mo. Absurd for ~4 users + breaks $0 + zero-ops.
- **Never let AI do the money math.** Balances/merge/carry-forward must be exact +
  auditable. AI may only ever DRAFT an input the user confirms; rules do the math.

## Tier table (verdict = NOW / LATER / SKIP)

| Tool | What it gives the user | Size | iPhone? | Verdict |
| --- | --- | --- | --- | --- |
| **winkNLP / compromise + chrono-node** | type *"40 milkshake today"* → amount+date+words extracted | ~100s of KB | ✅ | **NOW** (smart quick-add) |
| **Naive-Bayes classifier** (nbayes/WhichX/wink-bayes) | learns YOUR categories from your own labels; trained model is JSON (syncs in our blob) | ~**3 KB**, no model download | ✅ | **NOW** — replaces the 25 MB model for v1 |
| **Pure-JS insights** (run-rate, overspend, "3× your usual", forecast) | timely heads-ups, not just numbers | tiny | ✅ | **NOW / SOON** — under-used win, no AI needed |
| **Fuse.js** (fuzzy match) | merge matching, merchant grouping ("SQ *BLUE TOKAI" ≈ "Blue Tokai"), forgiving search | small | ✅ | **NOW/SOON** |
| **Transformers.js + ready categorizer** (e.g. `kuro-08/bert-transaction-categorization`) | smarter categories by meaning | ~25–50 MB | ✅ (WASM) | **LATER / only if Bayes too weak** |
| **PaddleOCR (PP-OCRv5) in-browser** | snap a receipt → ~99% char accuracy text, user corrects rest | ~10–30 MB one-time | ✅ (CPU, slower) | **LATER — advanced feature (Hemanth's call, not now)** |
| **Voice entry** | talk instead of type | — | ⚠️ via the **phone keyboard mic** only (our own button is blocked in iOS PWAs + not private) | NOW-ish (use OS keyboard mic; app only sees text) |
| **Chrome Built-in AI (Gemini Nano)** | free real LLM, on-device | 0 (browser ships it) | ❌ iOS/Android Chrome unsupported; desktop Chrome only | **LATER — desktop-only progressive enhancement** |
| **Full on-device LLM** (Qwen 0.5B / Llama 3.2 1B via WebLLM) | messy multi-clause understanding | 300–500 MB, WebGPU/iOS 18+ | ❌ excludes older iPhones | **SKIP for now** |
| Cloud receipt OCR (Google Vision 98% / Azure 90–94% / GPT-4o) | best receipt accuracy | — | n/a | **SKIP** — cloud, breaks privacy |

## OCR specifics (decided: LATER / advanced, NOT now)

- The phone's OWN great OCR — iPhone **Live Text** (Apple VisionKit) and Android
  **ML Kit / Google Lens**, both ~99% on-device — is **locked to native apps. A web
  app (our PWA) cannot call them from JavaScript.** The browser `TextDetector`
  (Shape Detection API) exists but is experimental and **broken on iOS 18**.
- The genuine web-usable option is **PaddleOCR (PP-OCRv5) via ONNX/WASM**
  (`ppu-paddle-ocr`, `gutenye/ocr`): **~99% char accuracy on receipts**, fully
  on-device/private, beats Tesseract.js by 5–15 points, works iPhone+Android+
  desktop (GPU where available, CPU on iPhone → slower). One-time ~10–30 MB.
- Tesseract.js (the obvious pick) is the WEAK option: ~97–99% only on clean flat
  receipts, ~60% on crumpled thermal ones — don't use it.
- **DECISION: add OCR later as an ADVANCED feature using PaddleOCR. Not now.**

## Net plan for "smart" UX (v1-ish)

Quick-add via NL parser (winkNLP/compromise + chrono) → naive-Bayes category
learning → Fuse.js for merge/search → pure-JS insights. All tiny, private,
offline, and identical on iPhone/Android/desktop. OCR, Transformers.js classifier,
Gemini-Nano, and full LLM are all deferred/optional.
