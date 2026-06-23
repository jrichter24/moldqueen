# Gamepad support

Drive with a **PS5 DualSense** (or any browser-supported) controller. Works on the
**excavator** dashboard **and both generic** layouts (12-axis, brick). (Back to the
[README](../README.md).)

> **Web/desktop only.** The browser **Gamepad API** is what reads the controller. Android's
> **System WebView has no Gamepad API**, so the in-app Android client can't use a pad — it
> degrades gracefully ("no controller") and **touch keeps working**. Use a desktop/mobile
> **browser** (e.g. Chrome) pointed at the Pi for gamepad control.

## Pairing

Pair the controller to the **device running the web client** (the machine with the
browser) — over USB or Bluetooth — *not* to the Pi/phone running the radio. The page reads
it through the browser; the resolved motion still travels the normal WS contract to whatever
radio core you're connected to.

## The Gamepad settings tab

Open **⚙ Settings → Gamepad** (the tab and the 🎮 menu chip appear when the layout enables
gamepad). You get:

- An **Enable gamepad** toggle + a **live readout** (axes/buttons) of the connected pad.
- One **binding row per function/motor** — for the excavator that's its six functions; for a
  generic layout it's the **12 motors** (`lstick_v/h`, `rstick_v/h`, `laxis`, `raxis`,
  `dpad_v/h`, `btn_13`, `btn_24`, `face_v`, `face_h`). Each row binds to either an **axis**
  (with invert) or a **button pair** (− / +).
- **DualSense defaults** out of the box, **editable** per row, with **reset to defaults**.
  Bindings persist in the browser.

## How a gamepad maps to generic MOTORS

The default is **physical control → same-named motor**: left stick → `lstick_h`/`lstick_v`
(axes 0/1), right stick → `rstick_h`/`rstick_v` (axes 2/3), d-pad → `dpad_h`/`dpad_v`, face
buttons → `face_v`/`face_h`, bumpers/triggers → `btn_13`/`btn_24`; `laxis`/`raxis` are left
unbound (no natural pad stick — bind them to triggers if you want).

Because a generic motor is only **inert until its channel is assigned**: if a motor has no
`(slot, channel)` in the layout's channel map, the gamepad drives it to *nothing* (same as
the on-screen control). So the gamepad drives exactly what the **auto-assign**
([ADDING_A_LAYOUT.md](ADDING_A_LAYOUT.md)) / channel map has mapped — bind the pad, then
auto-assign the toy, and it just works.

## Safety — same path, no new surface

Gamepad input rides the **exact same** drive path as touch:
`pad → driveFn(fn, value) → resolve (function→channel, invert/caps) → set` to the server,
re-affirmed by the **same affirmative keepalive**, and cut by the **same STOP**. STOP
**suppresses the pad** and it **re-arms only from center** (so a held stick can't lurch the
toy back into motion after a STOP, or when a controller (re)connects). There is **no
separate gamepad code path or safety surface** — it's the smart client's normal resolve +
keepalive + STOP. (Details: the safety model in [PROJECT.md](PROJECT.md).)
