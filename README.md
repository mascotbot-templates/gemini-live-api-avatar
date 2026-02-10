# Gemini Live API Avatar

> Real-time animated avatar with Gemini Live API and Mascot Bot SDK lip sync.

![Gemini Live API Avatar Demo](https://mascotbot-app.s3.amazonaws.com/rive-assets/og_images/og_gemini_liveapi.jpg)

## What This Demonstrates

- **Real-time lip sync** — frame-accurate viseme synchronization with Gemini audio responses
- **Google AI SDK compatibility** — works alongside `@google/genai` with zero conflicts
- **Ephemeral token security** — system instructions and voice config locked server-side
- **Natural mouth movements** — human-like lip sync processing that avoids robotic over-articulation
- **Token pre-fetching** — instant connection when users click "Start Call"
- **Microphone input** — full-duplex voice conversation with mute/unmute controls

## Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- [Mascot Bot SDK subscription](https://app.mascot.bot) (for `.tgz` package and `.riv` file)
- [Google Gemini API key](https://aistudio.google.com) (free tier available)

## Quick Start

1. Clone this repository
2. Add the required private files (see below)
3. Configure environment variables
4. Install and run

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the demo.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmascotbot%2Fgemini-live-api-avatar&env=MASCOT_BOT_API_KEY,GEMINI_API_KEY&envDescription=API%20keys%20required%20for%20Gemini%20Live%20API%20avatar%20integration&envLink=https%3A%2F%2Fdocs.mascot.bot%2Flibraries%2Fgemini-live-api-avatar&project-name=gemini-live-api-avatar-demo&repository-name=gemini-live-api-avatar-demo)

## Private Files You Need

### Mascot Bot SDK

- **File:** `mascotbot-sdk-react-X.X.X.tgz`
- **Where:** project root
- **How to get:** download from your [Mascot Bot dashboard](https://app.mascot.bot) after subscribing

```bash
cp /path/to/mascotbot-sdk-react-0.1.7.tgz ./
pnpm install
```

### Rive Animation File

- **File:** `mascot.riv`
- **Where:** `public/`
- **How to get:** provided with your Mascot Bot SDK subscription
- **Requirements:** must have `is_speaking` (Boolean), `gesture` (Trigger), and `character` inputs

```bash
cp /path/to/mascot.riv ./public/
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

| Variable | Description | Required |
|----------|-------------|----------|
| `MASCOT_BOT_API_KEY` | Mascot Bot API key (from [app.mascot.bot](https://app.mascot.bot)) | Yes |
| `GEMINI_API_KEY` | Google Gemini API key (from [aistudio.google.com](https://aistudio.google.com)) | Yes |

## Architecture

```
Browser (Client)
├── page.tsx — Main component with avatar + controls
│   ├── GoogleGenAI SDK — Gemini Live API connection
│   ├── useMascotLiveAPI() — SDK hook for lip sync + audio playback
│   └── MascotRive — Rive animation renderer (WebGL2)
│
└── /api/get-signed-url-gemini — Backend route
    ├── Creates Google ephemeral token (locks config server-side)
    └── Calls api.mascot.bot/v1/get-signed-url
        (wraps token and injects visemes into WebSocket stream)
```

### How It Works

The integration uses Google AI SDK's native `baseUrl` option. Your code uses `@google/genai` for everything — connecting, sending audio, handling callbacks. The only change is pointing `httpOptions.baseUrl` to `api.mascot.bot`. The proxy transparently forwards all Gemini traffic while injecting viseme data for lip sync.

**Do not connect directly to Google** — the avatar lip-sync requires viseme data that only the Mascot Bot proxy provides.

## Customization

### System Instruction & Voice

Edit the config in `src/app/api/get-signed-url-gemini/route.ts`:

```typescript
const GEMINI_CONFIG = {
  model: "gemini-2.5-flash-preview",
  systemInstruction: "Your custom system prompt here...",
  voiceName: "Aoede",       // Google's built-in voice
  thinkingBudget: 0,        // 0 = disabled for faster responses
  initialMessage: "Hello",  // Triggers assistant greeting
};
```

### Lip Sync Settings

Adjust in `src/app/page.tsx`:

```typescript
const lipSyncConfig = useMemo(
  () => ({
    minVisemeInterval: 40,        // ms between visemes
    mergeWindow: 60,              // merge similar shapes within window
    keyVisemePreference: 0.6,     // preference for distinctive shapes (0-1)
    preserveSilence: true,        // keep silence visemes
    similarityThreshold: 0.4,    // merge threshold (0-1)
    preserveCriticalVisemes: true, // never skip important shapes
    criticalVisemeMinDuration: 80, // min duration for critical visemes (ms)
  }),
  []
);
```

### Using Your Own Avatar

Update the `.riv` file path in `src/app/page.tsx`:

```typescript
const mascotUrl = "/mascot.riv"; // or a CDN URL
```

## Important Notes

- **Session limit:** Gemini Live API has a ~10-minute session limit per connection. After that, the WebSocket closes automatically and the user can reconnect.
- **Ephemeral tokens are single-use.** After a call ends, the cached token is consumed. The app automatically invalidates and pre-fetches a fresh token on disconnect.
- **Audio:** The `useMascotLiveAPI` hook handles audio playback automatically at 24kHz. Microphone input is captured at 16kHz PCM16.

## Links

- [Mascot Bot Documentation](https://docs.mascot.bot)
- [Gemini Live API Integration Guide](https://docs.mascot.bot/libraries/gemini-live-api-avatar)
- [Google AI Studio](https://aistudio.google.com) (for Gemini API keys)
- [Support](mailto:support@mascot.bot) | [Discord](https://discord.gg/SBxfyPXD)

## License

MIT License. See [LICENSE](./LICENSE).
