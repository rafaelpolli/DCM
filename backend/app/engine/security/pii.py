"""PII redaction patterns. Pure regex, no ML deps."""
from __future__ import annotations

import re
from typing import Iterable

PATTERNS: dict[str, re.Pattern[str]] = {
    "cpf": re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"),
    "cnpj": re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b"),
    "email": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    "phone": re.compile(r"\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d[ -]*?){13,19}\b"),
}


def redact(text: str, mask_types: Iterable[str], replacement: str = "***") -> str:
    out = text
    for kind in mask_types:
        pat = PATTERNS.get(kind)
        if pat:
            out = pat.sub(replacement, out)
    return out


def detect(text: str) -> dict[str, int]:
    """Count PII matches per type. Useful for scoring."""
    return {kind: len(pat.findall(text)) for kind, pat in PATTERNS.items()}
