"""Channel map: function -> (slot, channel, invert, labels). Pure data + resolution.

The server has NO hardcoded toy knowledge. Each function-mapped LAYOUT declares its
own FUNCTION SET (in the layout manifest, web/layouts.json) and its own default map
(``config/channel_map.<layout_id>.json``). validate/load are parameterized by that
function set — there is no global function list. A client may push an ACTIVE map
(default + its own overrides) for the session; the server resolves function -> nibble
against the active map, optionally applying a session-only device-0/1 (slot 0<->1)
swap. The broadcaster stays dumb — it only ever receives 12 nibbles, never a function
name. A layout with NO functions (e.g. RAW) doesn't use any of this.

Schema (per function): {slot:0-2, channel:0-3, invert:bool, max?:1-7,
reverse_scale?:0.25-4.0, label_en, label_de}. The optional `confirmed` flag is UI
metadata (verified vs placeholder).
"""
import os, json, tempfile, logging

log = logging.getLogger("channelmap")

REQUIRED_KEYS = ("slot", "channel", "invert", "label_en", "label_de")


def functions_of(mp):
    """The function names a map declares, in order (the layout's function set)."""
    return list(mp.get("functions", {}).keys()) if isinstance(mp, dict) else []


def _placeholder_map(functions):
    """Boot-survival fallback, used ONLY if a layout's JSON can't be read/parsed —
    distinct, clearly-unconfirmed placeholders over the layout's declared `functions`,
    just so the service boots. (Empty if the layout declares no functions.)"""
    fns = {}
    for i, f in enumerate(functions):
        title = f.replace("_", " ").title()
        fns[f] = {"slot": i // 4, "channel": i % 4, "invert": False, "max": 7,
                  "reverse_scale": 1.0, "label_en": title, "label_de": title, "confirmed": False}
    return {"version": 1, "functions": fns}


def load(path, functions=None):
    """Load + validate a layout's default map from `path` against its `functions` set;
    fall back to placeholders (over `functions`) on error."""
    try:
        with open(path) as fh:
            mp = json.load(fh)
    except (OSError, ValueError) as e:
        log.warning("channel map %s unreadable (%s) — using placeholder map", path, e)
        return _placeholder_map(functions or [])
    ok, errs = validate(mp, functions)
    if not ok:
        log.warning("channel map %s invalid (%s) — using placeholder map", path, "; ".join(errs))
        return _placeholder_map(functions or [])
    return mp


def save(path, mp):
    """Validate then atomically persist `mp` to `path`. Raises ValueError if invalid."""
    ok, errs = validate(mp)
    if not ok:
        raise ValueError("; ".join(errs))
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(mp, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def validate(mp, functions=None):
    """-> (ok, errors[]). If `functions` is given (a layout's function set) the map
    must define EXACTLY those; if None, validates whatever functions the map declares
    (structural-only, e.g. for generic save). Checks slot 0-2, channel 0-3, invert
    bool, optional max 1-7 / reverse_scale 0.25-4.0, labels, and NO duplicate
    (slot, channel) assignments."""
    errs = []
    if not isinstance(mp, dict) or not isinstance(mp.get("functions"), dict):
        return False, ["map must be an object with a 'functions' object"]
    fns = mp["functions"]
    expected = list(functions) if functions is not None else list(fns.keys())
    seen = {}
    for f in expected:
        a = fns.get(f)
        if not isinstance(a, dict):
            errs.append(f"missing function '{f}'")
            continue
        for k in REQUIRED_KEYS:
            if k not in a:
                errs.append(f"{f}: missing '{k}'")
        slot, ch = a.get("slot"), a.get("channel")
        if not isinstance(slot, int) or isinstance(slot, bool) or not (0 <= slot <= 2):
            errs.append(f"{f}: slot must be an integer 0-2")
        if not isinstance(ch, int) or isinstance(ch, bool) or not (0 <= ch <= 3):
            errs.append(f"{f}: channel must be an integer 0-3")
        if not isinstance(a.get("invert"), bool):
            errs.append(f"{f}: invert must be true/false")
        if "max" in a:
            mx = a["max"]
            if not isinstance(mx, int) or isinstance(mx, bool) or not (1 <= mx <= 7):
                errs.append(f"{f}: max must be an integer 1-7")
        if "reverse_scale" in a:
            rs = a["reverse_scale"]
            if not isinstance(rs, (int, float)) or isinstance(rs, bool) or not (0.25 <= rs <= 4.0):
                errs.append(f"{f}: reverse_scale must be a number 0.25-4.0")
        for k in ("label_en", "label_de"):
            if k in a and not isinstance(a[k], str):
                errs.append(f"{f}: {k} must be text")
        if isinstance(slot, int) and not isinstance(slot, bool) and isinstance(ch, int) and not isinstance(ch, bool):
            dup = seen.get((slot, ch))
            if dup:
                errs.append(f"{f}: duplicate slot {slot}/channel {ch} (already used by '{dup}')")
            else:
                seen[(slot, ch)] = f
    if functions is not None:                       # exact-set check only when a set is given
        extra = [k for k in fns if k not in expected]
        if extra:
            errs.append("unknown functions: " + ", ".join(sorted(extra)))
    return (not errs), errs


def resolve(mp, function, value, device_swap=False):
    """function + signed value (-7..7) -> (slot, channel, out_value), or None.

    Applies, in order: `invert` (negates value), the session `device_swap`
    (slot 0<->1; slot 2 untouched), and a per-function `reverse_scale` REVERSE-SPEED
    TRIM. The nibble map (0x8 + value) is byte-symmetric — confirmed against the app
    capture and the mkconnect reference (0xFF fwd / 0x00 rev / 0x80 stop) — so any
    forward/reverse SPEED difference is the hub's reverse PWM curve and/or the motor,
    not the encoding. `reverse_scale` (default 1.0 = identity) multiplies the REVERSE
    magnitude only, so the same speed setting can be tuned to match forward speed.
    The broadcaster never sees any of this — just nibbles.
    """
    a = mp.get("functions", {}).get(function)
    if not isinstance(a, dict):
        return None
    try:
        slot, ch = int(a["slot"]), int(a["channel"])
    except (KeyError, TypeError, ValueError):
        return None
    if device_swap and slot in (0, 1):
        slot = 1 - slot
    v = -int(value) if a.get("invert") else int(value)
    if v < 0:                                   # reverse-speed trim (post-invert direction)
        rs = a.get("reverse_scale", 1.0)
        if isinstance(rs, (int, float)) and not isinstance(rs, bool) and rs != 1.0:
            v = -max(0, min(7, round(abs(v) * rs)))
    return slot, ch, v
