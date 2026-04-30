"""VideoAdapter — programmatic video composition + render.

Per Doc 6 §14.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal, TypedDict, Union

JobStatus = Literal["queued", "rendering", "complete", "failed"]
AspectRatio = Literal["16:9", "9:16", "1:1", "4:5"]


class VideoComposition(TypedDict, total=False):
    id: str
    name: str
    duration_seconds: float
    width: int
    height: int
    fps: int
    scenes: object


class RenderJob(TypedDict, total=False):
    id: str
    composition_id: str
    status: JobStatus
    progress: float
    output_url: str
    error_message: str
    created_at: str
    finished_at: str
    cost_usd: float


class GeneratePromptOpts(TypedDict, total=False):
    prompt: str
    duration_seconds: float
    aspect_ratio: AspectRatio
    model: str


RenderInputByRef = TypedDict(
    "RenderInputByRef",
    {"composition_id": str, "opts": dict[str, object]},
    total=False,
)
RenderInputInline = TypedDict(
    "RenderInputInline",
    {"composition": VideoComposition, "opts": dict[str, object]},
    total=False,
)
RenderInput = Union[RenderInputByRef, RenderInputInline]


class VideoAdapter(ABC):
    vendor: str
    workspace_id: str

    @abstractmethod
    async def create_composition(self, comp: VideoComposition) -> str: ...

    @abstractmethod
    async def render(self, input_: RenderInput) -> dict[str, str]:
        """Returns {'job_id': ...}."""

    @abstractmethod
    async def generate_from_prompt(self, opts: GeneratePromptOpts) -> dict[str, str]: ...

    @abstractmethod
    async def get_job(self, job_id: str) -> RenderJob | None: ...

    @abstractmethod
    async def cancel_job(self, job_id: str) -> None: ...

    @abstractmethod
    async def health_check(self) -> dict[str, object]: ...
