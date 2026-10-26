"""
file_transfer.py — File chunking, reassembly and SHA-256 integrity verification.
"""
from __future__ import annotations
import binascii
import hashlib
import math

from .models import FileInfo, FrameInfo


def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_crc32(data: bytes) -> str:
    return format(binascii.crc32(data) & 0xFFFF_FFFF, "08x")


def prepare_file(
    filename: str,
    data: bytes,
    frame_payload_bytes: int = 512,
    seq_bits: int = 4,
) -> FileInfo:
    """
    Divide file data into frames and return FileInfo with all metadata.
    Handles zero-byte files (produces one empty frame).
    """
    modulus = 2 ** seq_bits
    if len(data) == 0:
        frame_count = 1
    else:
        frame_count = math.ceil(len(data) / frame_payload_bytes)

    frames: list[FrameInfo] = []
    for abs_seq in range(frame_count):
        start = abs_seq * frame_payload_bytes
        chunk = data[start: start + frame_payload_bytes]
        frames.append(FrameInfo(
            abs_seq=abs_seq,
            seq_no=abs_seq % modulus,
            payload_bytes=len(chunk),
            checksum=compute_crc32(chunk),
        ))

    return FileInfo(
        filename=filename,
        size_bytes=len(data),
        sha256=compute_sha256(data),
        frame_count=frame_count,
        payload_size=frame_payload_bytes,
        frames=frames,
    )


def verify_reassembly(original: bytes, received: bytes) -> tuple[bool, str, str]:
    """
    Compare original and received bytes.
    Returns (match, original_sha256, received_sha256).
    """
    orig_h = compute_sha256(original)
    recv_h = compute_sha256(received)
    return orig_h == recv_h, orig_h, recv_h
