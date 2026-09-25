# speechin 🎙️ — Speak. Done.

Smart voice dictation by **salim-slimani**: talk naturally → polished, ready-to-send text. No sign-up, no API keys.

## Run it
1. Serve the folder (the microphone needs localhost or https):
```
cd speechin
python3 -m http.server 8000
# open http://localhost:8000 in Chrome or Edge
```
2. Pick your speaking language, hit 🎙️, allow the microphone, talk.
3. No mic handy? Click **"See a live cleanup demo"**.

## Features (all local, no keys)
- 📝 Smart dictation: filler removal (um, uh, you know), repeat merging, final-intent detection ("actually I mean...")
- 📋 Auto formatting: bullets, numbered steps, email layout
- 🎭 Tones: formal / friendly / concise / detailed / email / bullets
- 🌍 Instant translation (free MyMemory, no key — needs internet)
- ✨ Command edit: shorter / longer / formal / friendly / bullets / summarize + custom commands
- 📖 Personal dictionary + 🕘 history — stored in localStorage (100% private)
- 📊 Stats: words / wpm / time saved + copy / save / .txt download

## Notes
- Speech recognition uses the Web Speech API (best on Chrome/Edge, needs internet).
- Cleanup runs fully locally in `app.js` → `polish()`.

---
© 2026 salim-slimani. All rights reserved.
