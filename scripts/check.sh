#!/usr/bin/env bash
# moldqueen — radio/environment health audit. Reports only; changes NOTHING and
# launches nothing (the codified version of the post-reboot audit). Thin wrapper
# over `start.sh --check`.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start.sh" --check
