# ⚡ LLM Tools — SillyTavern Extension

A SillyTavern extension that bundles a set of quality-of-life tools for roleplay: a floating widget with one-click actions (**Quick Erase**, **Continue**, **Rethink**, **Action**, **Speak**, **Think**, **Time Skip**), an immersive **Visual Novel Mode** with page-by-page reading, an **Alternate Greeting Picker**, in-message **LLM Translation**, and a **Dynamic Caption Prompt** generator for image attachments.

---

## ✨ Features

- **Quick Erase** — one click removes the last message (and any messages after it).
- **Continue** — fires the native `/continue` command from anywhere on screen.
- **Rethink** — regenerates the last AI message in one of 11 styles: Short, Detailed, Interactive, Narrative Only, Dialogue Only, Angry Tone, Romantic Tone, Random Length, Smart Length, Adaptive Length, or ✨ AI Choose (the LLM picks the best style itself). Also available as a per-message button and as **Auto Rethink** that applies the current style to every new reply.
- **Action / Speak / Think modals** — purpose-built dialogs to send an action, a spoken line, or an inner thought as the player. Each one has an optional **✨ AI Enhance** toggle that rewrites your draft via the current LLM before sending (cleaner phrasing, no meta).
- **Speak target picker** — in group chats you can choose who you're talking to; the message is automatically wrapped (`*Speak to <name>:*` or `"quotes"` for everyone).
- **Time Skip** — slider-based modal (hours + minutes) that sends a system prompt asking the AI to narrate what happened during the skip.
- **📖 Visual Novel Mode** — hides every message except the last one and renders it like a visual novel screen. Long AI replies are split into paragraphs with a **Continue** button so you read them one chunk at a time. Exposes a small read-only API (`window.LLMTools`) so other extensions (e.g. AutoVoice / XTTS) can stay in sync with the current chunk.
- **🎲 Alternate Greeting Picker** — when a character card has alternate greetings, opening a new chat shows a picker with previews instead of always defaulting to the first one.
- **🌐 LLM Translation** — adds a 🌐 button to each message that translates it on the fly using the current LLM. The original text stays in the chat history; only the displayed text changes, so the AI never sees the translation.
- **🖼️ Dynamic Caption Prompt** — when you attach an image, this hooks into the SillyTavern Caption extension and rewrites its system prompt to be context-aware based on the current character card and recent chat (so `{{char}}` is told what kind of image to expect).
- **Floating Widget** — toolbar with all the above actions. Four visual styles to pick from: **Classic Bar**, **Radial Bloom**, **Arc Fan**, **Minimal Orb**. Five positions including a fully draggable Custom mode.

---

## 📦 Installation

1. In SillyTavern, open **Extensions → Install Extension**.
2. Paste the URL of this repository and click **Install**.

Or install manually:

```
SillyTavern/
└── public/
    └── scripts/
        └── extensions/
            └── third-party/
                └── llm-tools/
                    ├── index.js
                    ├── style.css
                    └── manifest.json
```

Copy the files into a folder named `llm-tools` inside `third-party/`, then reload SillyTavern.

---

## ⚙️ Settings

Open **Extensions → LLM Tools** in the SillyTavern sidebar.

| Setting | Description |
| --- | --- |
| **Enable LLM Tools** | Master toggle for the entire extension. |
| **Show Floating Widget** | Show or hide the floating toolbar. |
| **Widget Position** | Bottom Center / Top Center / Top Right / Bottom Right / Custom (draggable). |
| **Widget Style** | Classic Bar, Radial Bloom, Arc Fan, or Minimal Orb. |
| **Auto Rethink** | Automatically apply the selected Rethink style to every new AI reply. |
| **Rethink Mode** | Default style used for both manual and Auto Rethink. |
| **📖 Visual Novel Mode** | Hide every message except the last one, with page-by-page reading. |
| **🎲 Alternate Greeting Picker** | Show a greeting selector when opening a chat with a character that has alternate greetings. |
| **🌐 LLM Translation** | Add a translate button to each message. |
| **Target Language** | Language used by the translate button (e.g. Russian, English, German, Japanese). |
| **🖼️ Dynamic Caption Prompt** | Auto-generate a context-aware caption prompt when you attach an image. |
| **Ask before updating prompt** | Show a confirmation toast before overwriting the Caption extension's prompt (sub-option). |

---

## 🖥️ Usage

### The Floating Widget

The widget appears on top of the chat with one button per action. Hover any button for a tooltip. Drag it freely when **Widget Position** is set to **Custom**. The dropdown next to **Auto** picks the current Rethink style for both manual and automatic mode.

### Rethink

There are three ways to trigger it:

- **Per-message button** (🧠 brain icon) on every AI reply — regenerates that specific reply in the currently selected style.
- **Widget button** — regenerates the last AI reply.
- **Auto Rethink toggle** — every new reply is automatically regenerated in the chosen style.

### Action / Speak / Think

Click the corresponding widget button to open a modal. Enter your text and (optionally) toggle **✨ AI Enhance** — the extension will send your draft to the current LLM with a tight prompt that strips quotes/asterisks/commentary and returns a clean one-to-two-sentence version before posting it to the chat as your message.

**Speak** also lets you pick a target character from the chat; the line is wrapped accordingly:

- Targeted: `*Speak to Alice:* "Your line here."`
- No target / everyone: `"Your line here."`

### Time Skip

Open the Time Skip modal, set hours and minutes with the sliders, and confirm. The extension sends a `/sysgen` prompt to the LLM that opens with a `*⏳ Time skips forward by Xh Ym...*` marker and asks the AI to narrate what happened — without speaking for the characters.

### Visual Novel Mode

Toggle from the widget (**VN** button) or from settings. While active:

- Only the last message is visible; the rest of the chat is hidden.
- Long AI replies are split into paragraphs. A **Continue ›** button at the bottom reveals the next paragraph.
- Other extensions can read the current chunk via `window.LLMTools.getCurrentVnChunkText()` — useful for TTS integrations so voice playback only covers what the user has actually read.

### Alternate Greeting Picker

When enabled, opening a chat with a character that has alternate greetings shows a picker with previews. Pick a greeting and the chat starts with that one as the opening message.

### LLM Translation

Click the 🌐 button on any message. The extension calls the current LLM with a short translation prompt and replaces the displayed text. Click the button again to restore the original. The chat history sent to the AI is never modified.

### Dynamic Caption Prompt

When enabled and you attach an image to a chat, the extension generates a caption prompt tailored to the current character — e.g. "Describe this image as **{{char}}** would perceive it, focusing on …" — and injects it into the SillyTavern Caption extension's prompt field. With **Ask before updating prompt** on, you get a confirmation toast first; otherwise it runs silently.

---

## 🔌 Public API

Other extensions can read VN Mode state via:

```js
window.LLMTools.isVnMode()                // boolean
window.LLMTools.getCurrentVnChunkIndex()  // number — index of the paragraph currently shown
window.LLMTools.getCurrentVnChunkText()   // string — text of the current chunk
window.LLMTools.getVnTextChunks($mes)     // array — all paragraphs of a message
```

All members are read-only; there are no mutators.

---

## 📋 Requirements

- A recent SillyTavern build with extension support.
- An LLM backend connected in SillyTavern (any backend works — the same one is used for Rethink, AI Enhance, Translation, and Dynamic Caption Prompt).
- For the Caption Prompt feature: the SillyTavern **Caption** (Image Captioning) extension enabled.

---

## 🧩 Compatibility

- Works in single-character chats and group chats.
- The Speak target picker auto-discovers every character present in the current chat (including group members).
- Visual Novel Mode coexists with the SillyTavern **translate** extension — paragraph splitting and high-water tracking survive translation toggling.

---

## 📄 License

MIT — free to use, modify, and distribute.
