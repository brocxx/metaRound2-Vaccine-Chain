# Vaccine Cold Chain — Mission Control (Frontend)

Cinematic Next.js dashboard for the Scalar School / OpenEnv hackathon
project [Vaccine-Cold-Chain-OpenEnv](https://github.com/brocxx/Vaccine-Cold-Chain-OpenEnv).

> An LLM agent reads a Barmer-district health briefing and uses it to
> disambiguate noisy temperature sensors, flooded roads and unreliable
> truck arrivals across a 3-node vaccine cold chain. This repo is the
> **frontend** — it visualises the agent's chain of thought, the
> environment state, and the lying-sensor moment that is the demo's
> screenshot star.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + CSS variables for the design tokens |
| Motion | Framer Motion + GSAP (queued) |
| Smooth scroll | Lenis |
| Sound | Web Audio synth (no audio assets) |
| Backend client | `fetch` against Person 1's FastAPI |

No 3D, no shader build pipeline — the hero "dither" is an animated SVG
turbulence layer, kept in `components/hero/HeroDither.tsx`.

## Local dev

```bash
npm install
npm run dev          # → http://localhost:3000
```

The dev server hot-reloads. The default data source is the seeded mock
trace, so the dashboard is fully usable without a backend.

### Routes

| Route | Purpose |
| --- | --- |
| `/` | Hero · pitch · brief grid |
| `/start` | Configure difficulty + briefing mode (auto / custom) |
| `/dashboard` | Mission Control — TriangleMap, BriefingPanel, AgentFeed, RewardBreakdown, HourTimeline, Transport |
| `/before-after` | Side-by-side prompt cards: zero-shot baseline vs. briefing-augmented agent |
| `/replay` | Read-only player for finished episodes (file upload or seeded demo) |

### Data sources

`lib/dataSource.ts` decides between two adapters:

- `mock` (default) — `lib/useEpisode.ts` walks the deterministic trace
  in `lib/mockEpisode.ts`. Per-difficulty briefings, scripted reasoning
  for the lying-sensor moment, baked-in events for flood / truck /
  outreach.
- `live` — `lib/useLiveEpisode.ts` calls `POST /reset` on mount and
  polls `GET /state` every second.

Toggle per tab with `?live=1` / `?live=0`, or set
`NEXT_PUBLIC_USE_LIVE=1` at build time.

If `live` mode hits any error (CORS, 404, network), the dashboard
gracefully falls back to the mock trace and shows a `live · backend
offline` chip in the header.

## Wiring to the backend

`lib/types.ts` mirrors the V2 `/state` schema from the bible:

```ts
{
  hour, max_hours, difficulty, briefing, briefing_source,
  done,
  nodes: { DVS_Barmer, CHC_Balotra, PHC_Sindhari } as Record<NodeKey, NodeStateV2>,
  roads: Partial<Record<RoadKey, "open" | "closed">>,
  outreach_schedule: OutreachScheduleEntry[],
  last_action: string | null,
  last_reasoning: string | null,
  events: EventV2[],
  reward_breakdown: { coverage, waste, missed_sessions, total },
  ethical_tension_active?: boolean,
  truck_eta_known?: boolean,
  truck_arriving_in_hours?: number | null
}
```

If the FastAPI shape drifts, edit `lib/types.ts` first; everything
downstream recompiles.

### Backend asks for Person 1

To go live we need:

1. **CORS** — allow our Vercel domain on `/health`, `/reset`, `/step`, `/state`.
2. **Schema lock-in** — `/state` matches `VaccineStateV2` exactly. The
   field names matter (`vials`, not `vial_count`; `sensor_reading`, not
   `temperature_c`).
3. **Reset signature** — `POST /reset` accepts
   `{ difficulty, user_briefing? }` and returns
   `{ observation, briefing, briefing_source, difficulty }`.
4. **Step signature** — `POST /step` accepts
   `{ action: VaccineAction, reasoning?: string }` so the agent's chain
   of thought streams into the AgentFeed.
5. **Deterministic seed** — keep the demo seed knob so we can replay the
   same lying-sensor scenario twice in a row.

## Deploy

### Vercel

```bash
# from C:\dev\vaccine-frontend
npx vercel        # one-time login + project link
npx vercel --prod
```

Set the env var on the Vercel dashboard:

```
NEXT_PUBLIC_ENV_BASE_URL = https://<your-hf-space>.hf.space
NEXT_PUBLIC_USE_LIVE     = 0   # flip to 1 once backend is live
```

The Hugging Face Space README should link out to the Vercel URL — the
HF Space hosts the FastAPI env, Vercel hosts this UI.

### Fallback demo asset

`public/demo.mp4` (not checked in) — a 30-second screen recording of a
hard-mode replay. The hero will autoplay it muted on first paint when
the backend is unreachable. Until that file exists the hero just renders
without it; it's a progressive enhancement.

## Project layout

```
app/
  layout.tsx              # SmoothScrollProvider + ReactiveCursor mount
  template.tsx            # AnimatePresence-style fade between routes
  page.tsx                # Hero
  start/page.tsx          # Pre-episode config
  dashboard/page.tsx      # Mission Control (mock + live adapters)
  before-after/page.tsx   # The pitch as two cards
  replay/page.tsx         # Read-only scrubber + key moments
components/
  chrome/                 # TopBar, SmoothScrollProvider, SoundToggle
  common/Typewriter.tsx   # Briefing + reasoning typewriter
  dashboard/
    TriangleMap.tsx       # SVG nodes + roads + transfer particles + sensor-lie halo
    BriefingPanel.tsx     # Teletyped district briefing
    AgentFeed.tsx         # LastAction + ReasoningStream + EventLog
    RewardBreakdown.tsx   # Animated coverage / waste / missed bars
    HourTimeline.tsx      # Scrubber with event markers
    Transport.tsx         # Task / play / pause / speed
  hero/
    KineticStrap.tsx      # Marquee
    HeroStat.tsx          # Brief stat tile
    AnimatedNumber.tsx    # Count-up on viewport enter
    HeroDither.tsx        # SVG turbulence + scanlines
    ReactiveCursor.tsx    # Cyan ring that lags + snaps to interactive
lib/
  api.ts                  # fetch wrapper around FastAPI
  types.ts                # V2 schema mirror
  mockEpisode.ts          # Deterministic seeded trace per difficulty
  useEpisode.ts           # Mock trace player
  useLiveEpisode.ts       # /reset + /state polling adapter
  dataSource.ts           # mock vs live switch
  episodeConfig.ts        # /start ↔ /dashboard handoff
  useSound.ts             # Web Audio synth + persisted mute
  cn.ts                   # tailwind class merger
```

## What V2 added (for reviewers)

- **Briefing as the centrepiece** — `BriefingPanel` teletypes the district
  brief on first paint of every episode.
- **Sensor-lie star moment** — `TriangleMap.SensorLieHalo` shows the
  reported sensor reading **and** the ground-truth temperature side by
  side with a pulsing amber halo, only when `node.sensor_lying`.
- **Agent chain-of-thought** — `AgentFeed.ReasoningStream` typewrites the
  agent's `last_reasoning` so judges read the "with briefing → correct"
  decision unfold in real time.
- **Indian facility names** — `DVS_Barmer`, `CHC_Balotra`, `PHC_Sindhari`,
  matching real district NHM nomenclature.
- **Ethical tension flag** — surfaces in the dashboard header when the
  episode forces a prioritisation between two simultaneous outreaches.

## Citations / further reading

- WHO. *eVIN India Programme*. 2018.
- NHM. *Cold Chain Equipment Maintenance Guidelines*. 2020.
- ROUND2_BIBLE_V2 — internal hackathon brief.
