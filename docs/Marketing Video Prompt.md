# Marketing Video Prompt: Luddo House

You are the director, editor and motion designer for the **Luddo House** launch film. Make a film people stop scrolling for, watch to the end and then want to play. Everything in it comes from the real app.

The bar is a premium launch film with one clear idea, built around a real moment between real people. It must not be a feature tour or a screen recording with music.

One shoot feeds every cut:

- social feeds (Reels, TikTok, Shorts)
- paid social, tested in hook variants
- the landing page and YouTube
- the **Product Hunt launch** (Section 8)
- localized versions (Section 7)

---

## 1. The product (start here, then check it yourself)

**Luddo House** (tagline: *Let's Play Luddo*) is a multiplayer Luddo game set at a photorealistic 3D table. It runs on the web at https://luddohouse.com and in iOS and Android apps.

- **Spelling:** always "Luddo", with two d's, for the brand (*Luddo House*, *Let's Play Luddo*) and for the game itself ("Luddo night"). Never write "Ludo" in on-screen text, captions, voiceover scripts or video titles. The app's About page (`/about`) explains the spelling to people who know the game as "Ludo".
- **Who it's for:** families and friends who live apart, and groups who want a game night. The audience is teens and adults. The app isn't designed for children, so don't show young children or aim the copy at them.
- **Positioning pillars** (`docs/COMPETITIVE_ROADMAP.md`, Section 1):
  1. **Made for a real table.** A 3D table in a furnished room. Players join from a link with no install. Video chat puts faces on the seats. Party Mode shows the table on a TV and uses phones as controllers.
  2. **No ads. No betting.** There are no interstitials, coins, pots or loot boxes.
  3. **Your rules.** Visible house rules and modes: Quick, Master, Rush, Team Up 2v2, and 5–6 players.
- **Languages:** the app ships in English, Hindi, Urdu, Bengali, Arabic, Indonesian, Brazilian Portuguese and Spanish (`lib/i18n/locales.ts`). Arabic and Urdu read right to left.
- **Brand look:**
  - font: Plus Jakarta Sans (Noto Nastaliq for Urdu)
  - icon: `assets/icon.png`
  - quadrant colours: red, green, yellow and blue from the printed board
  - end card: match the deep green gradient of the app's highlight-clip end card in `lib/presentation/clip.ts`, so the film and players' shared clips look like one brand

**What the camera can find:**

| Moment | Why it works on film | Where it lives |
|---|---|---|
| A capture: a pawn sent home | Luddo's universal drama, and the reaction is the story | Any match; `public/audio/` |
| The six you needed | Tension and release in one beat | Any match; `dice-six.wav` |
| The last pawn reaching home, then the win | The natural climax | Victory panel in `components/simulator/Simulator.tsx` |
| Faces at the seats (video chat) | Real human emotion inside the real UI; nothing else in the category has this | Online room, `video_chat` flag |
| Send a link, friends join from a browser | "That's easy" in 3 seconds | Lobby and share link |
| Party Mode: the table on a TV, phones as controllers | Living-room scale | `/screen`, with phones joining by QR code |
| The rooms: Apartment, Café, Lake Cabin, Rooftop, Mahogany Study | Beauty and variety for the montage | Room picker |
| House rules, Snakes & Ladders, earned dice and pieces | Depth, in quick cuts | Entrance setup, settings |

Explore before you commit. A moment you discover while playing may beat everything in this table.

> **Naming clash:** in this codebase, "Simulator" means the 3D table UI (`Simulator.tsx`). This prompt says **iOS Simulator** when it means Xcode's device simulator.

---

## 2. The creative idea

### Principles

1. **One idea per film.** If the film's idea doesn't fit in one sentence, it isn't ready. Features appear because the story needs them, not because they're on a list.
2. **Tell one game.** The default spine follows a single match from invitation to win, compressed into 30 seconds. A real game already has setup, rivalry, a reversal and a climax, so features show up naturally along the way: the link, the faces, the six, the capture, the win.
3. **The emotion is on the faces.** A pawn moving on a board is information. A sister groaning on her seat's video tile as her pawn is sent home is a story. Faces at the seats are both the strongest emotion and the strongest differentiator, so build the film around them.
4. **Be true to how Luddo is played.** People tease, hold grudges and plot revenge. They beg for a six. Cousins three time zones apart still keep score. Specific, warm and a little competitive beats generic "fun with friends".
5. **Be culturally specific, without stereotypes.** Luddo is a household game across South Asia, the Middle East, Africa, Indonesia and Latin America, and in their diasporas. A family spread across cities sharing one table is an authentic story for this product. Cast and dress it as modern, everyday people.

### Starting concepts

Pitch at least three concepts, including at least one of your own. Then recommend one. For each, give:

- the one-sentence idea
- the hook (the first 2 seconds)
- the spine, beat by beat
- why it will work, and on which platform
- what it needs: actors, a TV, live action

Three starting points:

- **A. "One table, wherever everyone is."** A family in four cities plays one game. Open cold on the capture and the reaction, rewind to the link being sent, watch the faces arrive at the seats, play, win, and pull back to the room. It needs four actors on video.
- **B. "Revenge is one roll away."** A rivalry film, punchy and built for paid social. Someone is sent home and swears revenge, the board swings back, then the six arrives and pays it off. It needs two to four actors.
- **C. "Game night, sorted."** Friends in one living room. The table is on the TV, the phones are the controllers, and everyone shouts at the screen. It needs live-action footage of a real TV and phones, shot by the user.

For tone, aim for the restraint of Apple's product films and the "together across screens" energy of Nintendo's Switch reveal. Take inspiration from them, but don't copy them.

---

## 3. Claims you may and may not make

On-screen text must be true of the shipped product today.

- **OK:** No ads. No betting. Play with friends from a link. Faces at the table. Play on your TV. Your house rules. Practice against the computer. The supported languages.
- **Only after checking:**
  - "Free": confirm the store price.
  - "Available on the App Store / Google Play" and store badges: the iOS release isn't finished (`docs/IOS_RELEASE.md`), so check that the listing is live, and follow Apple's and Google's badge guidelines.
  - "Dice you can check": only where F1.2 is live, worded with its caveat.
  - "A computer holds your seat if you drop": P5 behaviour varies by mode.
- **Never:** coins, wagers, prizes, "win big", or anything that looks like gambling. Naming or showing competitors. Invented UI, features or props that aren't in the app. Fake reviews, ratings or download counts.

Until store availability is confirmed, the default call to action is **"Play at luddohouse.com"**.

---

## 4. Rules for working in this repo

- **Don't touch the user's running work.** Port 3000 is the user's `next dev`, and `.next` holds their build. Port 3001 belongs to another project. Build and serve from a scratch git worktree on a free port such as 3917, and check the page `<title>` before you trust a port.
- **Use local Supabase for anything online,** with throwaway demo accounts. Never use production or real users' accounts.
- **Keep video tooling out of the app.** Don't add packages to the app's `package.json`. Build the edit in a separate scratch project (Remotion fits because it's React; ffmpeg is fine for assembly).
- **Keep footage out of git.** Write all footage and renders outside the repo, for example `~/Movies/LuddoHouse-Launch/`.
- **Keep capture changes in the scratch worktree and the local database.** Seeded dice, camera rigs, hidden tips and patched database functions must never be committed, turned into a migration, or reach production.

---

## 5. Workflow (three checkpoints)

### Phase 1: Explore, then pitch ▸ Checkpoint 1

1. Play the app: practice, an online room, every room, the camera views, Party Mode and video. Write down the moments that look good in motion and can be read in under 3 seconds.
2. Write `concepts.md` with three or more concepts in the Section 2 format, and your recommendation.
3. **Stop.** The user picks the concept.

### Phase 2: Storyboard and animatic ▸ Checkpoint 2

1. Write `storyboard.md` for the chosen concept. Include:
   - the hook line
   - a beat-by-beat timeline with on-screen text, the shot, the capture surface, the music cue and the sound effects
   - a numbered shot list giving each shot's start state, action and end state
   - every on-screen claim, mapped to Section 3
2. **Build a rough animatic** of the 30-second cut. Use stills and rough screen grabs, the real timing, the text cards and temporary music. Expect timing problems to show up here rather than on paper. Fix them before shooting.
3. **Write the casting and recording brief** if the concept uses faces. The agent can't film people, so the user records the actors. For each actor, give:
   - their role in the story
   - each reaction, with its cue time (for example: groan at 0:08.5, laugh at 0:09)
   - webcam framing at eye level, head and shoulders, centred
   - soft front light
   - a background that suggests their own home or city
   - wardrobe without logos
   - reminders to record 1080p, landscape, at a steady frame rate, with a signed release
   - every actor must be 18 or over, which video already requires
4. **Stop.** The user approves the storyboard, the animatic and the brief.

### Phase 3: Stage the set

Treat the app like a film set and dress it before you shoot.

- **Graphics:** use the highest graphics preset with reduced motion off. Pick the room that fits the story.
- **Players:** give them names that fit the cast and the language version, and use the bundled avatars (`public/avatars/`) for players without faces. Pre-accept the table rules (localStorage `luddo-table-rules-v1`), and dismiss the first-game tips unless the story needs them.
- **Online timing:** navigate within about 5 seconds of `start_match`, or the turn sweep gives the seats to the computer. Turn on the local `video_chat` and `online_age_check` flags, and switch them off afterwards.
- **Making the story happen on cue.** The story needs the six, the capture and the win to land at set times.
  - Practice games: seed the client-side dice in the scratch build.
  - Online games: patch the roll function in the **local** database only.
  - Either way, the UI must stay exactly as shipped.
- **Actors on the seats.** Convert each recorded actor clip to Y4M. Give each seat its own Chrome instance, launched with:

  ```
  --use-fake-device-for-media-stream --use-file-for-fake-video-capture=actor_N.y4m
  ```

  The real call pipeline then shows the real person in the real UI. With seeded dice, the game events happen at fixed times, so trim each clip so the reaction lands on its event.

  Never show test patterns, the default fake-camera feed, or real users. If there are no actors, cut the faces from the concept rather than faking them.
- **Clean frames:** no debug overlays, toasts, loading or error states, or dev banners. On iOS Simulator, set the status bar with `xcrun simctl status_bar booted override` where it shows. In-match it is already hidden.

### Phase 4: Capture

**Gameplay and UI (real time):**

| Surface | Use for | How |
|---|---|---|
| iOS Simulator, iPhone 6.9" (1320 × 2868) | Phone shots, 9:16 cuts, App Store preview | `npm run ios`, then `xcrun simctl io booted recordVideo --codec=hevc SHOT_xx.mov` |
| Desktop Chrome, **headed and GPU-backed**, 3840 × 2160 (or 1920 × 1080 at 2× DPR) | 16:9 table shots, video seats, TV and Party Mode | The web build from the scratch worktree. Headless Chrome without a GPU drops WebGL frames. iOS Simulator has no camera, so all video-seat shots come from Chrome. |
| Second device or browser | Party Mode phone controller, other players | Same build, another demo account |

- **One action per shot.** Settle the UI, start recording, perform the action, hold 1 second on the result, then stop.
- **Use the app's own camera for movement:** Seated, Overhead and Table views, plus orbit, pan and zoom (`L`, `1`/`2`/`3`). Keep digital push-ins to about 110% or less, because 3D footage turns soft beyond that.
- **Check frame rate.** Each shot should hold 60 fps (30 at minimum). Re-shoot stutters.

**Hero shots of the table (frame by frame, at 4K, with no stutter):** these are the shots that make the film look expensive. Use them for the reveal, the pull-back and the end card.

1. **Step the render manually.** In the scratch worktree, set the `<Canvas>` in `components/simulator/SimulatorScene.tsx` to `frameloop="never"`. Call `advance(frame / 60)` once per frame. It takes the elapsed time in seconds, not a step size.
2. **Read every frame.** Turn on `preserveDrawingBuffer`, read the canvas after each frame, and write a 3840 × 2160 PNG sequence.
3. **Fix the clocks that ignore the step.** Most animation runs through `useFrame`, which follows the step. A few spots read `performance.now()` directly (for example `SimulatorScene.tsx` around line 984), so patch those to the stepped clock.
4. **Move the camera on a path.** Drive it along an eased spline: a slow dolly across the board, a low pass past the glass pawns, a pull-back out of the room. Depth of field (via `@react-three/postprocessing`, in the scratch worktree only) is allowed if it stays subtle.
5. **Stay inside the real app.** Use only the app's real rooms, pieces and dice. Add no new geometry or props.
6. **Leave video tiles out.** Their textures don't step frame by frame.

Don't use the in-app highlight-clip recorder for any of this. It caps at 720p.

### Phase 5: Edit ▸ Checkpoint 3

**Default shape for 30 seconds:** a cold open, then the story, then the end card. Hold the 16:9 master to 40 seconds at most.

| Time | Beat | Notes |
|---|---|---|
| 0–2 s | **Cold open** | The film's best moment, shown first: the capture and the reaction, with the hook line. No logo intro. |
| 2–7 s | **Set-up** | Rewind to the start: the link is sent and the faces arrive at the seats, or the room is revealed in a hero shot. |
| 7–20 s | **The game** | 3–4 story beats of 3–5 seconds each, each with a 2–5 word line. Show outcomes, not controls. Pacing builds. |
| 20–25 s | **Climax** | The six, the last pawn home, the victory panel, the faces celebrating. |
| 25–30 s | **End card** | A hero pull-back from the table, then the icon, *Luddo House*, *Let's Play Luddo* and the call to action. Hold it for at least 2.5 seconds. If you have the footage, the players can say "Let's play Luddo" on their tiles. |

Example lines, to adapt to the chosen concept:

- "Luddo night. Wherever everyone is."
- "Sent home. From 3,000 miles away."
- "Revenge is one roll away."
- "Everyone at the table."
- "Send a link. Start playing."
- "Your house. Your rules."
- "No ads. No betting. Just Luddo."

**Typography:** a big line, with an optional small line under it. Never cover the board, the die, the moving pawn or a face. Take colours from the board's quadrant colours and the app's neutrals.

**Transitions:** let them come out of the scene, through match cuts (die to die, face to face, pawn to pawn), camera moves, masked pushes and short crossfades. Avoid spins, glitch effects, template wipes and particles.

**Sound:**
- **Music:** use only a licensed track the user supplies. If there isn't one, render with a marked placeholder and say so. Choose music with a build that peaks on the climax.
- **The dice as a motif:** make the rattle of the dice the sonic thread. Use it as a rhythmic element in the opening, and let `dice-six.wav` be the drop.
- **Sound effects:** the app's own: `public/sounds/dice-roll.wav`, `public/audio/dice-six.wav`, `ludo_piece_hopping*.wav`, `piece-home.wav`. Mix in the actors' real reactions as well, since laughs and groans sell the moment.
- **Sync:** land the die, the capture and the end card on beats. Mix to about −14 LUFS integrated for social.
- **Muted viewing:** most social views start muted, so the story must work without sound. Burn in text, and ship captions.

**Hook variants for paid social:** cut three different first 2 seconds onto the same body, for example a capture and reaction, the six landing, and a hero shot of the table with a question. Name them `_hookA`, `_hookB` and `_hookC` so the user can test thumb-stop and hold rates.

**Device frames:** let the table and the faces fill the frame by default. Use a phone frame only to say "on your phone", and a TV frame for Party Mode. Use clean, current device art and no frame on the App Store preview.

**▸ Checkpoint 3:** share the 30-second 9:16 cut and the 16:9 master, along with your Phase 6 scores. Make the other versions only after the user approves these two.

### Phase 6: Review (you can't watch it, so check it this way)

1. **Contact sheet:** render one at 2 fps (`ffmpeg -vf fps=2,scale=480:-1,tile=6x...`) and inspect every frame for clipped UI, stray toasts, stutter, and text covering the action or a face.
2. **Readability:** export the frames that carry text at 360 px wide. Every line must be readable at that size and on screen long enough to read (about 0.4 s per word, 1.2 s minimum).
3. **Muted check:** read only the on-screen text in order. It must still tell the story.
4. **Audio:** check loudness (`ffmpeg -af ebur128`) and that every sound effect lands on the frame of its event.
5. **Cold-viewer test:** give a fresh subagent only the contact sheet and the on-screen text, with no other context. Ask it what the product is, who it's for, the single reason to try it, and where it lost interest. If its answers don't match the concept, fix the edit.
6. **Score each item out of 5**, and revise anything below 4:

   | Criterion | The question |
   |---|---|
   | Thumb-stop | Would the first 2 seconds stop a scroll? |
   | Clarity | Is it clear what this is by about 6 seconds? |
   | Emotion | Is there a moment someone would feel? |
   | Single idea | Could the film's idea be said in one sentence? |
   | Proof | Is every claim shown in real UI and allowed under Section 3? |
   | Craft | Is it smooth, sharp, readable and synced? |
   | Memorability | Does the name stick? |

---

## 6. Deliverables

Write everything to the output folder, not the repo.

| File | Spec |
|---|---|
| `LuddoHouse_9x16.mp4` | **Primary social cut**: 1080 × 1920, 30 s, recomposed for vertical rather than cropped. Keep text clear of platform UI (the top 250 px and bottom 400 px). |
| `LuddoHouse_9x16_hookA/B/C.mp4` | Hook variants for paid social. |
| `LuddoHouse_16x9.mp4` | Landing page and YouTube master: 3840 × 2160 (or 1920 × 1080), 30–40 s. |
| `LuddoHouse_4x5.mp4`, `LuddoHouse_1x1.mp4` | Feed and paid social, recomposed. |
| `LuddoHouse_15s_9x16.mp4` | Ad cutdown: cold open, one beat, end card. |
| `ProductHunt/` | Section 8. |
| `Localized/<locale>/` | Section 7, for the locales the user picks. |
| `AppStorePreview_*.mp4` | **Only if** the user asks. Check Apple's current app preview specs first: in-app footage only, no device frames or hands, the exact resolution for each device, 15–30 s. |
| `*.srt` | Captions for every cut. |
| `concepts.md`, `storyboard.md`, `shotlist.md`, `casting-brief.md` | As approved, plus any changes made during the shoot. |
| `claims.md` | Each on-screen claim, and what verifies it. |
| `rights.md` | Music licence and actor releases. Also list the in-scene photographs and artwork (skyline, paintings, mug, lake, avatars) and the app's `background_01.mp3`, and flag any whose commercial-use rights aren't confirmed. |
| `raw/`, `renders/` | Every SHOT_xx capture, and the hero PNG sequences. |

Encode with H.264, High profile, yuv420p, at 30 or 60 fps (matching the capture), with AAC audio at 48 kHz.

---

## 7. Localized versions

Luddo's biggest audiences play in the app's other languages, so a localized film is a new film, not a translation.

- **Re-capture the UI in that language.** Switch the app's language and re-shoot the UI shots. Never put translated text over English UI.
- **Fit the cast and names** to the market where you can. A Hindi version with an Indian family across cities will beat the English film with subtitles.
- **Write the lines for the language,** rather than translating the English word for word. A native speaker must review every line before delivery. Note who reviewed each one in `claims.md`.
- **Right-to-left versions:** Arabic and Urdu mirror the text layout, and Urdu uses Noto Nastaliq.
- **Ask the user which locales to make.** Don't make them all by default.

---

## 8. Product Hunt

Product Hunt is a different setting from a social feed. Visitors are makers and early adopters, mostly on desktop. They choose to click play, usually with sound on, and want to see what the product is and how it works, not only how it feels. Use the same shoot, but make a separate cut.

**Specs** (from Product Hunt's [launch guide](https://www.producthunt.com/launch/preparing-for-launch); check them again before delivery):
- **Video:** a YouTube link only, set to unlisted or public, not private. Its slot in the gallery is 16:9.
- **Gallery:** at least 2 images, 1270 × 760.
- **Thumbnail:** square, 240 × 240.
- **GIFs:** under 3 MB each. They animate only on hover, and Product Hunt discourages strobing and quick cuts.

**The cut** (`ProductHunt/LuddoHouse_ProductHunt_16x9.mp4`):
- **Length and size:** 60–90 seconds, 1920 × 1080 or the 4K master's resolution.
- **Opening:** start with the main film's cold open and story, so the emotion lands first.
- **The walk-through:** follow it with a slower walk-through.
  - The full no-install flow in one readable sequence: create a room, copy the link, a friend opens it in a browser tab, and both are at the table. Frame the browser so viewers can see it's a web page.
  - The real-time 3D table running in a browser, switching between camera views.
  - Then the rooms, house rules, Party Mode, the languages, and video at the table.
- **Message:** "Play in your browser, no install" is the strongest message for this audience.
- **Pillars:** state "No ads. No betting." plainly, near the end.
- **Product Hunt references:** keep them out of the body of the film so it can be reused elsewhere. A short "Live on Product Hunt today" card at the end is fine. Add it only if the user wants it, and keep a version without it.
- **Sound:** sound will usually be on, so music and sound effects matter more here. A voiceover from the maker suits Product Hunt and is optional, but it must be the user's own voice, recorded by them. Don't use a synthetic voice unless the user asks for one. Burned-in text and captions still have to carry the story.
- **Call to action:** "Play at luddohouse.com". Add "free" only once it's confirmed (Section 3).

**Stills from the same shoot** (`ProductHunt/`):
- `youtube-thumbnail.jpg`, 1280 × 720: this is what shows in the gallery before play. Use a hero frame of the table, ideally with a face mid-reaction, and the name. Keep the text short, and don't use fake play buttons.
- `gallery-01…05.png`, 1270 × 760: the hero table shot, link joining, faces at the table, Party Mode, and house rules or rooms. Use real UI with one short headline each.
- `gallery-loop.gif`, 1270 × 760, under 3 MB: one calm loop, such as a die roll and a pawn hop, with no strobing or fast cuts.
- `thumbnail-240.png`, 240 × 240: the app icon from `assets/icon.png`, checked for sharpness at that size.

Prepare the files only. The user uploads to YouTube and submits to Product Hunt.

---

## 9. Ask the user before you…

- start the storyboard (Checkpoint 1: pick the concept)
- capture anything (Checkpoint 2: storyboard, animatic, casting brief)
- make the other versions (Checkpoint 3: the 30-second cut and the master)
- put any real person's face or voice on screen
- choose the locales to localize
- use store badges or the word "Free"
- use music, or any asset in `rights.md` whose rights aren't confirmed
- publish or upload anything anywhere
