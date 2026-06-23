# Adding a layout (bring your own dashboard)

How to add a control surface for **your own** Mould King toy. A layout is just **client
files** — there is **no server change** (the radio core is thin transport; the client owns
everything). This is the guide the chooser's *"Bring your own"* card promises. (Back to the
[README](../README.md) · architecture in [PROJECT.md](PROJECT.md).)

## What a layout is (4 pieces, all in `client/`)

1. **A manifest entry** in [`client/web/layouts.json`](../client/web/layouts.json) — the
   single source of truth. The server **derives the route `/<id>`** and serves the files;
   the chooser builds the card. No route/serve code anywhere.
2. **A thin `<id>.html`** — the **chrome shell**: it links `shell.css` + `chrome.css` +
   `<id>.css`, declares the `#app`/`#menu`/`#statusLight`/modal scaffold, sets
   `window.MK4_LAYOUT_ID`, and loads `i18n.js → clientconfig.js → chrome.js → <id>.js`.
   (Copy `generic_brick.html` or `dashboard.html`.)
3. **A control surface** — either **reuse the generic engine** (`generic.js`, just add a
   data SPEC — *no JS to write*) **or** your own `<id>.js` that calls
   `MK4Chrome.create({…, buildSurface})`.
4. **A channel map** [`client/web/channel_map.<id>.json`](../client/web/) — **client-owned**:
   `{ "version":1, "functions": { "<fn>": { slot, channel, invert, max_fwd, max_rev, reverse_scale, labels:{en,de,…} } } }`.

**You get [MK4Chrome](../client/web/chrome.js) for free:** the grouped menu (Startpage /
Connection / Settings), the tabbed settings, the connect wizard + startup guide, the status
light, the language picker, keyboard **STOP**, and the **gamepad** path — identical to every
other layout. Your code is *only* the control surface.

**The client resolves everything.** Your surface calls `api.driveFn(fn, value)`; the chrome
resolves *function → (slot, channel, value)* (invert / caps / device-swap) against your
channel map, runs the keepalive, and sends the low-level `set` over the WS contract. The
server never sees a function or a map. ([Why](PROJECT.md) — thin transport, smart client.)

### Generic vs model-specific

- **Generic** (`generic:true`) — a model-agnostic controller (the **12-axis** and **brick**
  layouts). Its channel map ships **unmapped** (`slot`/`channel` = `null`); the first-run
  **auto-assign wizard** maps the **12 motors** to channels by toy *profile*. Best when you
  just want sticks + buttons over any toy.
- **Model-specific** (the **excavator**) — named functions + a bespoke art dashboard; the
  channel map ships with real `(slot, channel)` values for that model.

---

## Path A — reuse the generic engine (easiest; no JS)

For a gamepad-style controller, you write **zero JavaScript** — `generic.js` already
provides the widgets (sticks, one-axis, d-pad, button pairs, STOP), the 12-motor model, and
the auto-assign wizard. You add **data**:

1. **Controller art** → `client/assets/generic_layouts/<id>.png` (+ an `<id>_icon.png` for
   the card).
2. **A SPEC** in `generic.js` (`SPECS`) — `image`, `aspect`, `title`, and `controls`
   (each control's % hotspot rect → which of the 12 motors it drives). Copy the
   `generic_brick` SPEC and move the rects onto your art.
3. **`<id>.html`** — copy `generic_brick.html`, set `window.MK4_LAYOUT_ID = "<id>"`.
4. **`channel_map.<id>.json`** — the 12 motor functions (`lstick_v/h`, `rstick_v/h`,
   `laxis`, `raxis`, `dpad_v/h`, `btn_13`, `btn_24`, `face_v`, `face_h`), all **unmapped**
   (`"slot": null, "channel": null`), 6-lang labels. Copy `channel_map.generic_brick.json`.
5. **Manifest entry** — `generic:true`, `kind:"function-mapped"`, `files` pointing at
   `generic.js` / `generic.css` and your `<id>.html`:
   ```json
   { "id": "mytoy", "name": "My Toy", "description": "One line.", "generic": true,
     "kind": "function-mapped", "category": "generic", "active": false,
     "icon": "/assets/generic_layouts/mytoy_icon.png",
     "protocols": ["mk4"],
     "functions": ["lstick_v","lstick_h","rstick_v","rstick_h","laxis","raxis","dpad_v","dpad_h","btn_13","btn_24","face_v","face_h"],
     "files": { "html": "mytoy.html", "js": "generic.js", "css": "generic.css" } }
   ```

On first open, the **auto-assign wizard** maps the motors to channels (pick a profile +
motor count, tweak inline) — then drive. Examples: `generic_12axis` and `generic_brick`.

## Path B — a custom MK4Chrome layout (bespoke dashboard)

For a model-specific dashboard with named functions + custom art (like the excavator):

1. **`<id>.html`** — the chrome shell (copy `dashboard.html`).
2. **`<id>.js`** — define your function names and a `buildSurface`, then create the chrome:
   ```js
   const FN = ["left_track", "right_track", "arm_lift", /* … */];
   function buildSurface(api) {
     // render your controls; on input call api.driveFn(<fn>, value)  (value -7..+7)
     // release → api.driveFn(<fn>, 0); register a reset with api.addControl(fn => …) for STOP/blur
   }
   MK4Chrome.create({
     layoutId: "mytoy", fnList: FN,
     title: { default: "My Toy", style: /* pct(...) overlay box */ },
     features: { deviceSwap: false, gamepad: true, labelsTab: true },  // channels:true is default
     buildSurface,
   });
   ```
   The `api` also gives you `scaleVal`, `lifecycle()`, `clearStopLatch`, `neutralizeAll`,
   `getMap`/`getGrid`, `funcLabel`, `dict`, `send`, etc. Reference: `dashboard.js`.
3. **`channel_map.<id>.json`** — each function with real `{slot, channel, invert, …, labels}`
   (you can ship placeholders and tune them in **Settings → Channels** on hardware).
4. **Manifest entry** — `kind:"function-mapped"`, your `functions` + `files`.

## WIP, then activate

Set **`"active": false`** while building: the **route `/<id>` still works** (open it
directly to test), but **no chooser card** appears until you flip `active: true`. Adding or
activating a layout **needs an API restart** (the server reads `layouts.json` at startup —
the Pi `api.py`, the Android core, and `client/serve.py` all derive routes from it; static
`.html`/`.js`/`.css` just need a browser refresh).

## Examples to copy

| Example | Pattern |
|---|---|
| `generic_12axis`, `generic_brick` | **Path A** — `generic.js` + a SPEC + unmapped map (`generic:true`) |
| `excavator` (`dashboard.js`) | **Path B** — custom `buildSurface` on MK4Chrome, mapped channels |
| `raw` (`raw.js`) | a non-standard surface on MK4Chrome (the protocol bench) |
| `template.{html,js,css}` | a **minimal, no-MK4Chrome** skeleton — talks the raw WS contract directly (own tiny menu + resolve). Good for learning the contract, but you **don't** get the shared chrome; prefer Path A/B for a real layout. |

## Notes / limits

- One **global** lifecycle/state on the server — fine for one driver (two layouts can't hold
  independent sessions yet).
- The Docker client serves via `client/serve.py` too, so a new layout needs **no** Docker/route
  config (see [REMOTE_CLIENT.md](REMOTE_CLIENT.md)).
- Gamepad on a generic layout drives the same motors (see [GAMEPAD.md](GAMEPAD.md)); unmapped
  motors are inert until auto-assigned.
