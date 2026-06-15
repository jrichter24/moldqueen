# bt-core/reference — MK4 protocol reference (working, version-controlled)

Snapshot of the **proven** Mould King 13112 control method, copied from the scratch
work area (`~/scratch/mk-refs/`) so the win is backed up in git. The working
implementation built from these is **[`../mk4web/`](../mk4web/)** (the control
webservice). **Canonical project doc: [`../../docs/PROJECT.md`](../../docs/PROJECT.md).**

| File | What it is |
|------|------------|
| [`CONNECT_PROCEDURE.md`](CONNECT_PROCEDURE.md) | The control procedure: MK4 nibble protocol, exact telegram bytes, slots, two-hub method. |
| [`channel_map.md`](channel_map.md) | Channel/slot → function map (confirmed + TBD). |
| [`mouldking_crypt.py`](mouldking_crypt.py) | The verified codec — `encode()`/`decode()`, reproduces the app's bytes exactly (13/13 self-tests). Self-contained. |
| [`mk4_test.py`](mk4_test.py) | Scratch transmit tool used to drive the hubs (builds telegrams + `hcitool` broadcast). |
| [`MKtech_reverse_engineering_report.md`](MKtech_reverse_engineering_report.md) | The MK+tech APK reverse-engineering report — how the protocol + crypt were recovered. |

**Caveats (scratch snapshots):** `mk4_test.py` imports `mouldking_crypt` via a
hardcoded `~/scratch/mk-refs` path and shells out to `hcitool`; `mouldking_crypt.py`'s
optional cross-check imports `mkconnect-python` from scratch (guarded — the core
codec + self-tests run standalone). Both will be properly ported into the worker.
