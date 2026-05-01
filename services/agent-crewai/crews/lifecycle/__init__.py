"""lifecycle crew — Doc 4 §2.10.

Weekly evaluator over the workspace's published artefacts. Per-piece
decisions: repost top performers, repurpose long-form into short, retire
underperformers, recommend boost spend on winners.

Repurposing pipeline: a top thread becomes a blog; a top blog becomes a
video script; a top video becomes a meme. Each repurpose is a draft that
flows through the standard approval path.

Acceptance per Doc 4: top-quartile content is automatically considered for
repurposing within 7 days; lifecycle decisions logged + visible per artefact.
"""

from .crew import build_lifecycle_crew

__all__ = ["build_lifecycle_crew"]
