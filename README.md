# Speech Bubbleinator — Overlay speech bubbles onto images, GIFs, and videos in Discord

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tech Stack](https://img.shields.io/badge/Tech-Bun%20%7C%20TypeScript%20%7C%20discord.js%20%7C%20sharp%20%7C%20ffmpeg-blue)]()

A Discord bot that takes user-submitted media — images, GIFs, and videos — and overlays a speech bubble graphic on top. Trigger it via slash command or message prefix, and the bot replies with the processed media and deletes the original message. Built for meme creators, content sharers, and communities that want a quick way to add a visual punchline to any piece of media.

## ✨ Key Features

* **Speech Bubble Overlay:** Composites a speech bubble image onto the top of static images, animated GIFs, and video files. Static images are processed with sharp; GIFs and videos are handled via ffmpeg with a filter_complex pipeline (`scale2ref`, `pad`, `overlay`).
* **Smart Media Resolution:** Resolves media from multiple sources with an intelligent fallback chain — direct attachments, provided URLs, Open Graph meta tag scraping (up to 3 levels deep with loop detection), embed URLs, links in message content, or media from replied-to messages.
* **Progressive Encoding:** Automatically tries up to 4 quality/size encoding profiles (decreasing FPS, scale, and color count for GIFs; increasing CRF for MP4s) to fit within the server's upload limit based on its premium tier (10MB / 50MB / 100MB).
* **Dual Interface:** Accessible via `/globo-de-testo` slash command (with attachment and link options) or via prefix commands (`-globear`, `-globo-de-sexo`, `-<url>`) in regular messages.
* **Format Handling:** Accepts static images (output as GIF), animated GIFs (output as GIF), and videos (output as MP4). All processing respects the original media type and chooses the appropriate output format.
* **Timeout Safety:** All HTTP fetches use a 15-second timeout via `AbortController`; ffmpeg processes have a 45-second timeout to prevent runaway encoding jobs.
* **Message Cleanup:** After processing and replying with the speech-bubbleified media, the bot deletes the original trigger message for a clean chat experience.

## 🛠️ Tech Stack & Libraries

* **Runtime:** Bun (all-in-one JS/TS runtime, bundler, and package manager)
* **Language:** TypeScript (ESNext target, strict mode, ESM modules)
* **Discord API:** discord.js v14.22.1
* **Image Processing:** sharp v0.34.3 (static images)
* **Video/GIF Processing:** ffmpeg via `child_process.spawn` (external system dependency)
* **Environment Validation:** envalid v8.1.0
* **Logging:** pino v9.13.0 + pino-pretty
* **Linting/Formatting:** Biome v2.2.5

## 🏗️ Architecture & Code Structure

```
├── src/
│   ├── bot.ts                                # Entry point — client setup, loaders, login
│   ├── assets/
│   │   └── image.png                         # Speech bubble overlay asset
│   ├── commands/
│   │   ├── ping.ts                           # /ping — simple health check
│   │   └── globo-de-texto/
│   │       └── globear.ts                    # /globo-de-testo slash command
│   ├── events/
│   │   ├── interactionCreate.ts              # Slash command handler with cooldown
│   │   ├── ready.ts                          # Client ready — logs stats
│   │   └── messageCreate/
│   │       └── globear.ts                    # Prefix command handler (-globear, etc.)
│   └── utils/
│       ├── config.ts                         # Environment variable parsing
│       ├── cooldown.ts                       # Per-user cooldown system
│       ├── logger.ts                         # Pino logger configuration
│       ├── media.ts                          # Media resolution (attachments, URLs, OG tags)
│       ├── speechBubble.ts                   # Core overlay logic (sharp + ffmpeg)
│       ├── loaders/
│       │   ├── commands.ts                   # Dynamic command file loader
│       │   ├── deploy.ts                     # Discord API slash command registration
│       │   ├── events.ts                     # Dynamic event file loader
│       │   └── getAllFiles.ts                # Recursive .ts file discovery
│       └── types/
│           ├── command.ts                    # Command interface
│           ├── event.ts                      # Event interface
│           └── globals.d.ts                  # Discord.js Client augmentation
```

### Media Resolution Fallback Chain

```
1. Direct attachment on the message
2. Direct URL provided as argument
   → If URL returns HTML, parse Open Graph tags (og:video, og:image, etc.)
   → Recursively resolve extracted URL up to 3 levels deep
3. Embed media URLs from the message
4. Links found in message content
5. Media from the replied-to message (attachment, embed, or content link)
```

### Processing Pipeline

```
Static Image:
  sharp → load image + bubble → resize bubble to match width
  → create padded canvas → composite bubble on top + image below → output GIF

GIF / Video:
  ffmpeg with filter_complex:
    scale2ref (bubble to input) → pad (add top space) → overlay (composite)
  → Try progressive encoding profiles until file fits server upload limit
  → Output GIF (for GIF input) or MP4 (for video input)
  → Clean up temp directory
```

## ⚙️ Setup and Installation

**Prerequisites:** [Bun](https://bun.sh) and [ffmpeg](https://ffmpeg.org/download.html) installed on your system.

1. Clone the repository:

```bash
git clone https://github.com/notmomoi/speech-bubbleinator.git
cd speech-bubbleinator
```

2. Install dependencies:

```bash
bun install
```

3. Set up environment variables:

Create a `.env` file in the root directory:

```env
TOKEN=your_discord_bot_token
CLIENT_ID=your_application_client_id
GUILD_ID=your_guild_id
SHOW_DEBUG=false
```

4. Deploy slash commands to your guild:

```bash
bun run deploy
```

5. Start the bot:

```bash
bun start
```

The bot will log in and be ready to process media via `/globo-de-testo` or the `-globear` / `-globo-de-sexo` prefix commands.
