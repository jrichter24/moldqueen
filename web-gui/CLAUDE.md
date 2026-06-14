# web-gui

A **very light** browser control panel to drive the excavator. Deliberately
minimal: **vanilla JS + a tiny Node server, no framework.**

## Purpose

Give a human a simple browser UI to send commands to the excavator. The UI will
ask **java-core** to build telegrams, which a **bt-core** worker broadcasts. The
wiring from this panel to java-core is **TBD**.

## Stack

- **Node.js 20 LTS** — server uses only built-in modules (`node:http`,
  `node:fs`). **Zero npm dependencies** (keep it that way; this Pi has little RAM).
- **Vanilla HTML/CSS/JS** in `public/` — no build step, no bundler, no framework.

## Run

```bash
cd web-gui
npm start                 # = node server.js
# then open http://localhost:8080/
```

Override host/port with env vars: `PORT=9000 HOST=127.0.0.1 npm start`.

## Layout

```
web-gui/
├── package.json          # name, "start" script, no dependencies
├── server.js             # minimal static file server (node:http/fs)
└── public/
    └── index.html        # the panel — currently just an "alive" page
```

`server.js` serves static files from `public/` (defaulting to `index.html`) and
guards against path traversal. That's all it does today.

## Keep it light — house rules

- **No frameworks, no bundlers, no client-side npm deps** unless there's a
  genuine need we've discussed. Prefer plain DOM APIs.
- Add server-side dependencies only if unavoidable; the goal is near-zero
  `node_modules`.
- It's a control panel, not an app — favour clarity and small files.

## Boundaries

- **Downstream:** will talk to [`../java-core/`](../java-core/) to produce
  telegrams (transport **TBD** — e.g. a small HTTP/IPC bridge). web-gui never
  touches the radios and never builds telegrams itself — that's java-core's job,
  and broadcasting is bt-core's.
