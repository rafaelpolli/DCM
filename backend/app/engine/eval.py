"""Agent evaluation — text-overlap metrics (no external ML deps).

Metrics implemented:
  exact_match          — 1.0 if answer matches ground_truth (case-insensitive)
  token_f1             — F1 on token overlap; standard SQuAD-style metric
  context_relevance    — max Jaccard overlap between question tokens and any context chunk
  answer_faithfulness  — fraction of answer tokens supported by the retrieved contexts
"""
from __future__ import annotations

import re
from collections import Counter

from pydantic import BaseModel


# ── Request / response models ───────────────────────────────────────────────

class EvalRow(BaseModel):
    question: str
    contexts: list[str] = []
    answer: str
    ground_truth: str = ""


class EvalRequest(BaseModel):
    rows: list[EvalRow]


class RowMetrics(BaseModel):
    question: str
    answer: str
    ground_truth: str
    exact_match: float
    token_f1: float
    context_relevance: float
    answer_faithfulness: float


class EvalResult(BaseModel):
    rows: list[RowMetrics]
    aggregate: dict[str, float]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text.lower())


def _token_f1(pred: str, gold: str) -> float:
    pred_c = Counter(_tokenize(pred))
    gold_c = Counter(_tokenize(gold))
    if not pred_c or not gold_c:
        return 0.0
    common = sum((pred_c & gold_c).values())
    precision = common / sum(pred_c.values())
    recall = common / sum(gold_c.values())
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def _context_relevance(question: str, contexts: list[str]) -> float:
    if not contexts:
        return 0.0
    q_tokens = set(_tokenize(question))
    if not q_tokens:
        return 0.0
    best = 0.0
    for ctx in contexts:
        ctx_tokens = set(_tokenize(ctx))
        union = q_tokens | ctx_tokens
        if union:
            best = max(best, len(q_tokens & ctx_tokens) / len(union))
    return best


def _faithfulness(answer: str, contexts: list[str]) -> float:
    if not contexts:
        return 0.0
    ctx_tokens = set(_tokenize(" ".join(contexts)))
    answer_tokens = _tokenize(answer)
    if not answer_tokens:
        return 0.0
    return sum(1 for t in answer_tokens if t in ctx_tokens) / len(answer_tokens)


# ── Public entry point ───────────────────────────────────────────────────────

_METRIC_KEYS = ["exact_match", "token_f1", "context_relevance", "answer_faithfulness"]


def run_eval(req: EvalRequest) -> EvalResult:
    rows: list[RowMetrics] = []
    for row in req.rows:
        em = 1.0 if row.answer.strip().lower() == row.ground_truth.strip().lower() else 0.0
        rows.append(RowMetrics(
            question=row.question,
            answer=row.answer,
            ground_truth=row.ground_truth,
            exact_match=em,
            token_f1=round(_token_f1(row.answer, row.ground_truth), 4),
            context_relevance=round(_context_relevance(row.question, row.contexts), 4),
            answer_faithfulness=round(_faithfulness(row.answer, row.contexts), 4),
        ))
    if not rows:
        agg: dict[str, float] = {k: 0.0 for k in _METRIC_KEYS}
    else:
        agg = {
            k: round(sum(getattr(r, k) for r in rows) / len(rows), 4)
            for k in _METRIC_KEYS
        }
    return EvalResult(rows=rows, aggregate=agg)
