---
name: Modern Boardroom
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#414755'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#717786'
  outline-variant: '#c1c6d7'
  surface-tint: '#005bc1'
  primary: '#0058bc'
  on-primary: '#ffffff'
  primary-container: '#0070eb'
  on-primary-container: '#fefcff'
  inverse-primary: '#adc6ff'
  secondary: '#005cba'
  on-secondary: '#ffffff'
  secondary-container: '#5095fe'
  on-secondary-container: '#002d61'
  tertiary: '#bb0011'
  on-tertiary: '#ffffff'
  tertiary-container: '#e22525'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#d7e3ff'
  secondary-fixed-dim: '#aac7ff'
  on-secondary-fixed: '#001b3e'
  on-secondary-fixed-variant: '#00458e'
  tertiary-fixed: '#ffdad6'
  tertiary-fixed-dim: '#ffb4ab'
  on-tertiary-fixed: '#410002'
  on-tertiary-fixed-variant: '#93000a'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 34px
    fontWeight: '700'
    lineHeight: 41px
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 25px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 22px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 13px
  timer-display:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-sm: 0.5rem
  margin: 1rem
  margin-lg: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system is engineered to elevate traditional board gaming into a premium, focused mobile esport experience. Drawing strictly from Apple iOS Human Interface Guidelines and modern Swiss architectural minimalism, the visual tone avoids garish skeuomorphism, cartoonish gradients, and noisy carnival visuals common to casual mobile games. Instead, it positions the experience as a refined, tactile, and mathematically balanced competition.

The design movement combines **Contemporary iOS Flat Architecture** with **Precision Tactile Minimalism**:
- **Purity and Structure:** Light, airy canvas spaces anchored by ultra-fine hairline structural dividers, letting the four-player color quadrants orchestrate gameplay readability.
- **Physical Metaphor Restraint:** Tactile elements (game tokens, dice, turn pods) simulate high-grade matte ceramic, molded resin, and precision-cut acrylic through geometry, layered surface elevation, and micro-haptics rather than heavy drop shadows or bevels.
- **Player Distinction:** Four iconic, WCAG AAA/AA accessible quadrants (Crimson Red, Cobalt Blue, Emerald Green, Golden Yellow) provide instant visual indexing on a calm, high-efficiency iOS canvas.

## Colors

The palette balances clean iOS system tones with saturated competition identifiers:

### System & Interface Neutrals
- **Canvas Base:** `#F8F9FA` — Crisp, cool off-white background preventing eye strain during sustained play.
- **Surface Elevation (Cards, Sheets):** `#FFFFFF` — Pure white for modal sheets, cards, and dice faces.
- **Hairline Borders & Dividers:** `#E5E7EB` — Crisp 0.5pt-to-1pt structural lines separating board cells and metadata.
- **Text & High-Contrast Anchors:** Primary text at `#111827`, secondary labels at `#6B7280`, tertiary/muted states at `#9CA3AF`.

### Player Quadrant Colors
- **Player Red (Crimson):** `#E02424` (Background tint: `#FDF2F2`, Accent border: `#F87171`)
- **Player Blue (Cobalt):** `#0066CC` (Background tint: `#EFF6FF`, Accent border: `#60A5FA`)
- **Player Green (Emerald):** `#0E703C` (Background tint: `#ECFDF5`, Accent border: `#34D399`)
- **Player Yellow (Golden):** `#F5A623` (Background tint: `#FFFBEB`, Accent border: `#FBBF24`)

### Interactive & Economy Accents
- **System Action (Apple Blue):** `#007AFF` — Reserved strictly for navigation, confirmations, and primary system controls.
- **Economy Gold (Chips/Coins):** Container `#FFF8E1`, Currency Icon/Text `#B45309`, Border `#FDE68A`.

## Typography

The type hierarchy conforms to Apple Human Interface Guidelines for iOS point scales, leveraging **Plus Jakarta Sans** for its geometric clarity, tight neutral spacing, and tall x-height that mirrors native SF Pro rendering across mobile densities.

- **Display & Large Headlines:** Used for match victory/defeat screens, level progression badges, and primary lobby banners. Set tight with `-0.4px` letter spacing.
- **Body Text:** Scaled between 13px and 17px with strict vertical rhythm. Maintains neutral grayscale `#111827` to optimize fast recognition in high-intensity moments.
- **Labels & Turn Metadata:** Fixed at medium/semibold weights to ensure numeric readability (dice face counts, turn countdown timers, coin balances) even at micro scales during live 4-player matches. Tabular figures are used for all live countdowns and currency counters to avoid jitter.

## Layout & Spacing

The layout is built around mobile-first thumb-reach zones and square aspect-ratio preservation for the board matrix:

- **Board Arena:** Centered squarely in the primary viewport with strict `1rem` edge margins on standard phones (375pt–430pt widths).
- **Player Quadrant Anchoring:** Four status pods pinned to the 4 corners of the board arena or organized top-to-bottom in a 2x2 split dock depending on portrait orientation limits.
- **Spacing Scale:** Built on a rigorous 4pt / 8pt grid (`0.25rem` step). Gaps between cell tiles are locked at `2px` to `4px` to preserve board continuity while allowing individual cell hit targets to meet the minimum 44×44pt accessibility standard.
- **Bottom Action Drawer:** A fixed floating dock at `margin: 1rem` from bottom safe areas housing the dice roller, quick chat, and active status indicators.

## Elevation & Depth

Visual hierarchy achieves depth through layered tonal contrast and ambient micro-occlusion rather than heavy drop shadows:

1. **Level 0 (Base Canvas):** `#F8F9FA`. Recessed substrate on which cards and the board matrix sit.
2. **Level 1 (Board Cells & Passive Cards):** `#FFFFFF` surface with a crisp `1px` hairline stroke of `#E5E7EB`. Subtle ambient blur: `box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04)`.
3. **Level 2 (Active Player Pods & Dice Cup):** `#FFFFFF` elevated container, `1px` border matching active player quadrant color (e.g., `#60A5FA` for Blue), with diffused shadow: `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06)`.
4. **Level 3 (Tactile Ceramic Tokens & Dice):** Floating physical game pieces. Tokens feature an inner concentric ring stroke and a grounded contact shadow: `box-shadow: 0 3px 6px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.6)`.
5. **Level 4 (Modals & Victory Sheets):** Floating iOS sheet at `backdrop-filter: blur(20px)`, surface `#FFFFFF` at 92% opacity, anchored by `box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12)`.

## Shapes

The design system employs consistent iOS continuous-curve corner radii (`roundedness: 2`, base `0.5rem` / 8px):

- **Dice Blocks:** 16px corner squircle with a precision-molded profile.
- **Ceramic Disk Tokens:** Full circle (`9999px`) with dual concentric inner rings for authentic board token tactility.
- **Player Status Pods & Cards:** `12px` to `16px` radius (`rounded-lg` to `rounded-xl`) with smooth corner transitions mirroring native iOS cards.
- **Economy Chips & Turn Badges:** Pill-shaped (`rounded-full`), enclosing avatars, coin numbers, and turn indicators.

## Components

### 1. Primary & Secondary Buttons
- **Primary Action (Apple Blue):** Background `#007AFF`, text `#FFFFFF`, height 50pt, radius 12pt, semibold 17pt font. Active press scale down to `0.97` with haptic feedback.
- **Quadrant Action Buttons:** When rolling or taking quadrant-specific actions, primary button dynamically shifts to the active player color (`#E02424`, `#0066CC`, `#0E703C`, or `#F5A623`) with white text.
- **Secondary / Ghost:** `#FFFFFF` fill with `1px` solid `#E5E7EB` border, text `#111827`.

### 2. The Dice Component
- Physical dimension: 56×56pt up to 64×64pt.
- Body: Pure `#FFFFFF`, micro-radius 14pt, crisp hairline border `#E5E7EB`.
- Pips: Deep black `#111827` recessed circles with subtle specular highlights. Six-roll triggers an energetic accent pulse using the active player's color.

### 3. Ceramic Disk Tokens (Pawns)
- Flat, modern disk profile rendered top-down.
- Fill: Solid quadrant color with an outer 1.5pt `#FFFFFF` perimeter ring to ensure high contrast against any cell surface.
- Inner motif: Subtle engraved circle representing tournament-grade ceramic carrom/ludo tokens.
- Multi-token stacking: Offsets by 3pt with micro-badges indicating token count (e.g., `x2`, `x3`).

### 4. Player Status Pod
- Card layout containing player avatar (36pt circle), username, remaining tokens home/active, and turn status.
- **Turn Countdown Timer:** Embedded circular SVG ring around avatar or linear border glow that depletes over 15 seconds from player quadrant color into warning `#EF4444`.
- Passive state: Opacity 0.72, plain `#E5E7EB` border.
- Active turn state: Opacity 1.0, 1.5pt border in player color, micro-scale `1.03`.

### 5. Coin & Diamond Pill Chips
- Background `#FFF8E1`, border `1px` solid `#FDE68A`.
- Gold coin icon anchored on the left, tabular bold numeric count `#B45309`.
- Compact 28pt height, fully rounded pill radius (`9999px`).

### 6. The Board Matrix Cells
- Standard pathway cells: Pure white `#FFFFFF`, `1px` hairline grid `#E5E7EB`.
- Safe star cells: Neutral light gray `#F3F4F6` with an engraved geometric star icon `#9CA3AF`.
- Home runs: Tinted 12% opacity in corresponding quadrant color leading to the central triumph triangle.