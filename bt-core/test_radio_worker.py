import io

from radio_worker import format_payload, run


def test_format_payload_hex():
    assert format_payload(bytes([0x01, 0xAB, 0xFF])) == "01 ab ff"


def test_format_payload_empty():
    assert format_payload(b"") == "<empty>"


def test_run_counts_payloads():
    stream = io.BytesIO(b"\x01\x02\n\x03\x04\n")
    assert run(stream) == 2
