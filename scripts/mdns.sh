#!/usr/bin/env bash
# moldqueen — advertise the Pi radio core under a stable mDNS name (moldqueenrasp.local),
# mirroring the ESP32's moldqueenesp.local, so the client can point at
# ws://moldqueenrasp.local:8765 instead of the Pi's IP.
#
# ADDITIVE + OPTIONAL: it publishes an EXTRA mDNS address-record alias — the Pi's normal
# <hostname>.local keeps working, the system hostname is NOT renamed, and if avahi-utils
# isn't installed this no-ops gracefully (the core still works by IP). mDNS is an
# enhancement, never a hard dependency.
#
# Needs:  avahi-daemon (running, standard on Raspberry Pi OS) + avahi-utils
#         (apt install avahi-utils) for the `avahi-publish` tool.
# How:    runs `avahi-publish` in the FOREGROUND and must STAY ALIVE to hold the record
#         (avahi unpublishes when it exits). scripts/start.sh launches this in the
#         background alongside the core; the optional scripts/moldqueen-mdns.service runs
#         it always (survives reboot). Resolve check: avahi-resolve -n moldqueenrasp.local
#
#   scripts/mdns.sh                      # publish moldqueenrasp.local -> this Pi's primary IP
#   MK4_MDNS_NAME=foo scripts/mdns.sh    # publish foo.local instead
#   MK4_NO_MDNS=1     ...                 # honored by start.sh to skip mDNS entirely
set -euo pipefail

NAME="${MK4_MDNS_NAME:-moldqueenrasp}"

if ! command -v avahi-publish >/dev/null 2>&1; then
  echo "mdns: avahi-publish not found — skipping mDNS name (the core still works by IP)." >&2
  echo "mdns: to enable discovery by name:  sudo apt install avahi-utils" >&2
  exit 0
fi
if ! { systemctl is-active --quiet avahi-daemon 2>/dev/null || pgrep -x avahi-daemon >/dev/null 2>&1; }; then
  echo "mdns: avahi-daemon not running — skipping mDNS (IP still works)." >&2
  exit 0
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$IP" ]; then
  echo "mdns: could not determine an IP — skipping mDNS." >&2
  exit 0
fi

echo "mdns: advertising ${NAME}.local -> ${IP}  (resolve: avahi-resolve -n ${NAME}.local)" >&2
# -a address-record, -R no reverse PTR (the host already owns its reverse). Stays foreground.
exec avahi-publish -a -R "${NAME}.local" "$IP"
