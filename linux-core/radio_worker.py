#!/usr/bin/env python3
"""moldqueen radio worker — PLACEHOLDER (no BLE yet).

One worker process owns exactly one Bluetooth adapter (e.g. hci0 for hub A,
hci1 for hub B). Its job, once real, is: take payload bytes from java-core and
continuously re-broadcast them as BLE advertising "telegrams" over a raw HCI
socket (socket.AF_BLUETOOTH / socket.BTPROTO_HCI), bound to one hci index,
until it is handed new bytes.

This is the ONLY layer that touches the radios. It will need root or the
cap_net_raw,cap_net_admin capabilities, and bluetoothd must be stopped first so
it doesn't grab the adapter.

For now this stub just reads payloads from stdin and logs them, so we can prove
the toolchain end-to-end without any hardware. The IPC/protocol with java-core
is intentionally left as plain stdin (newline-framed) and is expected to change.
"""

from __future__ import annotations

import logging
import sys

logger = logging.getLogger("radio_worker")


def format_payload(data: bytes) -> str:
    """Render raw payload bytes as a space-separated hex string for logging.

    Pure, hardware-free, and unit-tested — this is the seam the test exercises.
    """
    if not data:
        return "<empty>"
    return data.hex(" ")


def run(stream=None) -> int:
    """Read newline-framed payloads from a binary stream and log each one.

    Returns the number of payloads handled. No BLE is performed.
    """
    if stream is None:
        stream = sys.stdin.buffer

    count = 0
    for raw_line in stream:
        payload = raw_line.rstrip(b"\n")
        logger.info("payload[%d] (%d bytes): %s", count, len(payload), format_payload(payload))
        count += 1
    return count


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logger.info("radio_worker stub started (no BLE). Reading payloads from stdin; Ctrl-D to end.")
    handled = run()
    logger.info("radio_worker stub done. Handled %d payload(s).", handled)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
