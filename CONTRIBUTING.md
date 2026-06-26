# Contributing to moldqueen

Thanks for your interest. moldqueen is a small, independent open-source project, and
contributions are welcome, from a bug report to a whole new toy layout.

## Ways to contribute

- **Issues.** Bug reports, hardware quirks, and feature ideas all help. Include your
  setup (Pi or Android, dongle, which Mould King model) and what you saw vs. expected.
- **Pull requests.** Small, focused PRs are easiest to review. Describe what changed and
  why; if it touches the radio or the safety path, say how you tested it on hardware.
- **A new layout / toy.** This is the most useful contribution. The layout system is
  designed for it: a layout is just client files (a manifest entry, a thin page, and a
  channel map), no core changes needed. Start with
  [`dev-docs/ADDING_A_LAYOUT.md`](dev-docs/ADDING_A_LAYOUT.md).
- **Translations.** The UI is i18n-driven (`client/web/i18n.js`); English and German are
  complete, the other languages are seeded and welcome refinement by native speakers.

## Conventions to respect

These keep the project coherent; please work with them rather than around them.

- **Thin transport, smart client.** The radio core carries only low-level
  `set {slot, channel, value}` and the connect/safety lifecycle. All semantics, channel
  maps, function-to-channel resolution, layouts, labels, live in the client. Don't push
  resolution or per-toy knowledge into the radio core.
- **One client, no forks.** There is a single web client in [`client/`](client/); the Pi
  and Android cores both serve that same code (Android bundles it at build). Don't fork
  the UI per platform, prefer a flag or a config option over a branch.
- **The safety model is not optional.** Motion is momentary; the client re-affirms held
  values about ten times a second (an affirmative keepalive), the server auto-neutralizes
  any channel not refreshed in time, and STOP kills the radio and reconnects at neutral.
  If you add a control path, it must go through the same resolve + keepalive + STOP, not
  around it. See the safety notes in [`dev-docs/PROJECT.md`](dev-docs/PROJECT.md).
- **Keep it light.** The Pi has 1 GB of RAM; the client is vanilla HTML/CSS/JS with no
  build step. Resist heavy dependencies.
- **Small, clear commits** (`feat:` / `fix:` / `docs:` / `chore:`). Never commit secrets.

The canonical reference for how everything fits together is
[`dev-docs/PROJECT.md`](dev-docs/PROJECT.md) (it wins on any disagreement). Component
must-knows live in each folder's `CLAUDE.md`. The running backlog (what's planned, in
progress, stalled, or recently done) is [`WORKBOARD.md`](WORKBOARD.md) — keep it current.

## On purpose: the AI-assisted workflow is in version control

moldqueen was built with help from AI coding assistants. Architecture, product
decisions, testing, and final code review remained under human control. We keep the
**AI-workflow files in the repository on purpose**, where most projects gitignore them,
for two reasons: **transparency** about how an AI-assisted project is actually built, and
to give others a **working example** to copy for their own setup.

- **[`CLAUDE.md`](CLAUDE.md)** (root, plus one per component folder): the project's
  "must-knows" for an AI assistant, the terse, durable context (the protocol facts, the
  thin-transport rule, operational gotchas) that a fresh session needs so it doesn't
  re-learn or contradict the project. It's equally useful to a new human contributor.
- **[`.claude/agents/`](.claude/agents/)**: a small set of specialist subagent
  definitions — one per component (`client-dev`, `linux-core-dev`, `android-core-dev`,
  `docs-dev`, and `esp32-core-dev` — the working third radio core), and two cross-cutting agents:
  `code-reviewer` (review a finished chunk against the plan) and the **read-only**
  `auditor` (whole-project reality + documentation-currency checks — it reports and cites,
  but cannot edit or decide). Each has a description that scopes when it should be used and
  explicit boundaries, so AI-assisted work is routed to the right area instead of sprawling
  across the repo.

You don't need to use any of this to contribute. But if you want to run an AI-assisted
workflow, these files are a tested starting point, copy them, adapt the facts and the
agent roster to your project, and keep them honest as the code changes.

## Support

If moldqueen is useful to you, you can support it on
[Ko-fi](https://ko-fi.com/A437HBY) ☕. It is free and open source either way.
