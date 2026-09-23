---
name: ui-ux
description: Use when designing, building or reviewing a user interface, or matching a supplied screenshot or design - direction and tokens, all states, accessibility and polish, proven by comparing the running page rather than claimed taste.
---

# UI and UX

Three layers, in order: the rules for what counts as evidence, the foundations, then polish.

## Evidence rules

1. **Decide a direction, then apply it everywhere.** One type scale, one spacing rhythm, one set
   of colour roles, one control shape. A token that exists in a stylesheet but is overridden on
   every element is not a design system.
2. **Build the states, not just the happy one.** Loading, empty, error and success each need real
   content: what happened and what to do next. An empty table is not an empty state.
3. **Look at the rendered page.** Screenshots at the declared viewports, a keyboard walkthrough of
   the primary journey, 200% zoom, reduced motion. Measure the layout in the live document; a
   screenshot that exists is not a result.
4. **A native target is observed on its platform.** A responsive web page is never the
   deliverable for a native application, however good it looks on a phone-sized viewport.
5. **Record where every asset came from and under what licence.** No competitor's logo, no
   unlicensed image. Generating one needs an available tool, permitted data transfer and
   approved cost.
6. **Do not claim taste.** Automated checks find a subset of accessibility problems and can
   measure hierarchy ratios. They do not establish conformance, usability, beauty or client
   satisfaction. Say which of those you did not establish.

When feedback arrives — "too crowded", "hard to find the button" — change the presentation and
leave the business rules alone. Re-verify the journeys the change touched.

## Reproducing a reference

When the person supplies a screenshot or design to match, the task is **reproduction, not
redesign**. Say which mode you are in before you start. In reproduction the reference is the target
and there is no creative licence: no "more premium", no extra effects. In design you propose a
direction and get it approved before spreading it. A task is never both.

1. **Split the authority.** The reference governs how the target page looks. The existing app
   governs business rules, permissions, validation and API behaviour. List the existing styles,
   components or instructions that conflict with the reference, and say so rather than letting
   the old style win quietly.
2. **Break the reference down before coding:** proportions and layout, typography (family, sizes,
   weights), spacing and density, hierarchy, colours, borders and icons, assets. Anything read off
   pixels — a font, an exact spacing — is labelled an estimate.
3. **One representative page first.** Do not spread the styling to other pages until this one is
   accepted.
4. **Compare the running page, not the code.** Serve it with representative data and capture it at
   the reference's viewport:
   `node <this skill>/scripts/visual-check.mjs --url <page> --reference <png> --out .visual-check`
   (add `--scale 2` for a Retina screenshot).
   Open `compare.png` and look at it. The mismatch ratio and regions say where to look; they are not
   a score.
5. **Fix the three largest differences, in this order:** layout and proportions → typography →
   spacing and density → colour, borders, icons. At most **two correction passes per batch**, then
   report the remaining differences or a revised diagnosis instead of more CSS churn.
6. **Then make it reusable.** Extract the shared tokens and components, and keep the accepted render
   as the reference for later visual checks, under pinned conditions (browser, fonts, data). Never
   update a reference to make a check pass.

A matching screenshot is not a usable page. Visual match and usability — errors shown, input kept
after a failed save, loading states, keyboard use, small screens — are separate acceptance checks.

## Foundations

- **Layout and spacing:** a consistent spacing scale (4/8px rhythm) on a grid. Whitespace is a
  feature. Clear hierarchy through size, weight, colour and spacing; one primary action per view.
- **Typography:** a handful of sizes, body line-height around 1.5, a 60–75 character measure,
  strong heading/body contrast, one or two families.
- **Colour and contrast:** a small palette (neutrals plus one accent). WCAG AA — 4.5:1 for text,
  3:1 for large text. Never colour alone to carry meaning. Dark mode through tokens, not hex.
- **Responsive:** mobile-first, fluid, tested at real breakpoints. Tap targets at least 44px.
  Respect safe areas and `prefers-reduced-motion`.
- **Accessibility (non-negotiable):** semantic HTML, labelled inputs, visible focus, keyboard
  operable, alt text, ARIA only where semantics fall short, async state changes announced.
- **Performance:** no layout shift, lazy-load below the fold, responsive images, nothing blocking
  the main thread. Measure it (`gauge-improvements`).

## Polish

- **Tokens drive everything** — colour, space, radius, shadow, type, motion. Components carry
  every interactive state: default, hover, focus, active, disabled, loading, error.
- **Motion has a purpose** — feedback, continuity, attention — never decoration. Fast
  (150–250ms), eased, interruptible; animate transform and opacity, not layout.
- **Micro-interactions:** press feedback, input focus, optimistic toggles, skeleton to content,
  quiet success cues.
- **Detail:** considered elevation, pixel-aligned icons with consistent strokes, empty states that
  teach, error states that offer a way out.
- **Restraint:** polish is consistency and clarity, not more effects. If an interaction does not
  help the user, cut it.

## Review checklist

Hierarchy clear? Spacing consistent? AA contrast? Keyboard and focus? All states built? Responsive
at real breakpoints? No layout shift? Tokenised? Motion purposeful and reduced-motion safe? What
did you observe rendered, and what did you not establish?
