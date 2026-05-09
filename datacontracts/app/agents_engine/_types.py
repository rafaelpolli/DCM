"""Shared types for the code generation pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CompiledFile:
    """A single generated file: its path inside the ZIP and its text content."""
    path: str
    content: str


@dataclass
class CompiledArtifacts:
    """All files produced by the full pipeline, keyed by path inside the ZIP."""
    files: dict[str, str] = field(default_factory=dict)

    def add(self, f: CompiledFile) -> None:
        self.files[f.path] = f.content

    def add_all(self, files: list[CompiledFile]) -> None:
        for f in files:
            self.add(f)

    def merge(self, other: "CompiledArtifacts") -> None:
        """Merge another CompiledArtifacts into this one (other wins on collision)."""
        self.files.update(other.files)
