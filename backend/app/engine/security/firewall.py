"""Prompt firewall — input sanitization patterns to detect prompt injection attempts."""
from __future__ import annotations

import re

DEFAULT_BLOCK_PATTERNS: list[str] = [
    r"(?i)ignore\s+(previous|prior|all|the\s+above)\s+instructions",
    r"(?i)disregard\s+(previous|prior|the\s+above)",
    r"(?i)you\s+are\s+now\s+",
    r"(?i)\bsystem\s*:\s*$",
    r"(?i)\bdeveloper\s+mode\b",
    r"(?i)\bDAN\b.*(do anything now)",
    r"(?i)esquece (tudo|as instruc[oõ]es|o anterior)",
    r"(?i)agora voc[eê] [eé]\s",
    r"(?i)reveal (your|the) (system|prompt|instructions)",
    r"(?i)mostre (suas|o) (instru[cç][oõ]es|prompt|sistema)",
]


def compile_patterns(extra: list[str] | None = None) -> list[re.Pattern[str]]:
    patterns = DEFAULT_BLOCK_PATTERNS + (extra or [])
    return [re.compile(p) for p in patterns]


def screen(text: str, extra: list[str] | None = None) -> tuple[bool, list[str]]:
    """Returns (blocked, matched_patterns). blocked=True means input is suspicious."""
    matched: list[str] = []
    for pat in compile_patterns(extra):
        if pat.search(text):
            matched.append(pat.pattern)
    # Base64 length heuristic — long unbroken base64-looking strings can hide payloads
    if re.search(r"[A-Za-z0-9+/=]{200,}", text):
        matched.append("base64-like-blob>200chars")
    return (len(matched) > 0, matched)
