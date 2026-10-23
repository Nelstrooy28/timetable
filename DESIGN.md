# DESIGN.md: Timetable

Direction chosen by the owner: keep and sharpen the existing printed-sheet
identity. This file records what that identity is, so future UI work holds it.

## Identity

A printed weekly timetable, the kind pinned inside a lecture-room door. Warm
paper, ruled columns, ink-drawn course marks, a serif masthead. The product is
one student's week, not a dashboard.

- **Personality:** quiet, precise, academic. Nothing decorative competes with the
  week itself.
- **Mood:** a sheet of paper on a desk, not an app on a screen.
- **Audience:** one student, reading it on a laptop before class and on a phone
  between classes.

## Palette

Two cores plus one accent, per R-29.

| Role | Value | Why |
|---|---|---|
| Paper (page) | `#efe9dc` | Warm stock, so the sheet reads as a sheet |
| Surface (sheet) | `#fffdf7` | The printed page itself |
| Tinted row | `#f6f1e5` | Weekend and header band, as a printer would shade a section |
| Ink | `#1b211d` | Near-black green-ink, warmer than pure black |
| Ink secondary | `#414c44` | Body text |
| Muted | `#5c665e` | Labels and metadata (5.87:1 on surface) |
| Accent | `#1f5b47` | Ink-green: current day, primary action, focus ring only |
| Amber | `#7d4a12` | "Edited locally" state, nothing else |
| Danger | `#9c2b21` | Destructive actions and errors |

Course colours are **data encoding**, not decoration: seven muted pencil inks
(indigo, teal, ochre, rose, blue, violet, olive). They mark which course a class
belongs to, and the course code is always printed beside them, so colour is
never the only channel.

## Typography

- **Masthead and modal titles:** Iowan Old Style / Palatino / Georgia serif.
  Reason: the masthead of a printed timetable is set in a book face; it sets the
  document apart from app chrome.
- **Everything else:** Segoe UI / system sans at 10–14px.
  Reason: the grid carries dense small text that needs an unambiguous screen
  face, and tabular numbers for times.
- Times always use `font-variant-numeric: tabular-nums` so columns of times line
  up, as they do in print.

## Structure

1. **Masthead:** title, student and semester, actions.
2. **Week bar:** the week being read, with previous/next steps. One row, tinted.
3. **The sheet:** a time grid on a laptop, a day-by-day agenda on a phone. Same
   data, two compositions, because 15 hours of columns cannot be read at 375px.
4. **Colophon (footer):** what state the timetable is in, and how it saves.

## Dials

**ENERGY 1 / RHYTHM 2 / MOTION 1.**

- ENERGY 1: the week is the only thing that should shout. Buttons are quiet.
- RHYTHM 2: the masthead, the week bar and the sheet have distinct weights, then
  the grid repeats by nature.
- MOTION 1: hover, focus and a 120ms toast only. No entrance animations, no
  moving backgrounds. The clock line moves because time moves.

## Motif

The **ruled sheet**: a hairline under every day, hour ticks on the ruler, and a
single ink-green rule that marks the current day. It appears in the grid, the
agenda and the print sheet, so the three read as one document.

## Rules kept from the existing build

- No shadows except the drag ghost and the dialog, both elevation.
- Radius is 8px for controls and cards, 12px for the sheet. Never pills.
- The only glow is the focus ring.
