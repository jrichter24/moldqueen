"""Channel map: function -> (slot, channel, invert, labels). Pure data + resolution.

The server has NO hardcoded toy knowledge — the map is loaded from JSON
(``config/channel_map.json``, the persisted DEFAULT). A client may push an ACTIVE
map (default + its own overrides) for the session; the server resolves
function -> nibble against the active map, optionally applying a session-only
device-0/1 (slot 0<->1) swap. The broadcaster stays dumb — it only ever receives
12 nibbles, never a function name.

Schema (per function): {slot:0-2, channel:0-3, invert:bool, label_en, label_de}.
The optional `confirmed` flag is metadata for the UI (verified vs placeholder).
"""
import os, json, tempfile, logging

log = logging.getLogger("channelmap")

# Canonical functions, in display order. A valid map defines EXACTLY these.
FUNCTIONS = ["left_track", "right_track", "arm_lift", "front_arm", "rotation", "bucket"]
REQUIRED_KEYS = ("slot", "channel", "invert", "label_en", "label_de")


def _placeholder_map():
    """Boot-survival fallback, used ONLY if the JSON can't be read/parsed. Distinct,
    clearly-unconfirmed placeholders — not toy knowledge, just so the service boots."""
    fns = {}
    for i, f in enumerate(FUNCTIONS):
        title = f.replace("_", " ").title()
        fns[f] = {"slot": i // 4, "channel": i % 4, "invert": False, "max": 7,
                  "label_en": title, "label_de": title, "confirmed": False}
    return {"version": 1, "functions": fns}


def load(path):
    """Load + validate the default map from `path`; fall back to placeholders on error."""
    try:
        with open(path) as fh:
            mp = json.load(fh)
    except (OSError, ValueError) as e:
        log.warning("channel map %s unreadable (%s) — using placeholder map", path, e)
        return _placeholder_map()
    ok, errs = validate(mp)
    if not ok:
        log.warning("channel map %s invalid (%s) — using placeholder map", path, "; ".join(errs))
        return _placeholder_map()
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


def validate(mp):
    """-> (ok, errors[]). Checks all functions present, slot 0-2, channel 0-3,
    invert bool, labels present, and NO duplicate (slot, channel) assignments."""
    errs = []
    if not isinstance(mp, dict) or not isinstance(mp.get("functions"), dict):
        return False, ["map must be an object with a 'functions' object"]
    fns = mp["functions"]
    seen = {}
    for f in FUNCTIONS:
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
        for k in ("label_en", "label_de"):
            if k in a and not isinstance(a[k], str):
                errs.append(f"{f}: {k} must be text")
        if isinstance(slot, int) and not isinstance(slot, bool) and isinstance(ch, int) and not isinstance(ch, bool):
            dup = seen.get((slot, ch))
            if dup:
                errs.append(f"{f}: duplicate slot {slot}/channel {ch} (already used by '{dup}')")
            else:
                seen[(slot, ch)] = f
    extra = [k for k in fns if k not in FUNCTIONS]
    if extra:
        errs.append("unknown functions: " + ", ".join(sorted(extra)))
    return (not errs), errs


def resolve(mp, function, value, device_swap=False):
    """function + signed value (-7..7) -> (slot, channel, out_value), or None.

    Applies `invert` (negates value) and the session `device_swap` (slot 0<->1;
    slot 2 is left untouched). The broadcaster never sees any of this — just nibbles.
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
    return slot, ch, v
