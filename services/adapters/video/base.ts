// VideoAdapter — programmatic video composition + render.
// Per Doc 6 §14. Wraps OpenMontage / Remotion / fal.ai video models.

export interface VideoComposition {
  id: string;
  name?: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps?: number;
  // Adapter-specific scene tree. Adapters validate against their own schema.
  scenes: unknown;
}

export interface RenderJob {
  id: string;
  compositionId?: string;    // present when rendering an existing composition
  status: "queued" | "rendering" | "complete" | "failed";
  progress?: number;          // 0..1
  outputUrl?: string;
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
  costUsd?: number;
}

export interface VideoAdapter {
  readonly vendor: string;
  readonly workspaceId: string;

  /** Programmatic compositions (Remotion / OpenMontage). */
  createComposition(comp: Omit<VideoComposition, "id">): Promise<string>;

  /** Kick a render. Either pass an existing compositionId or an inline composition. */
  render(input:
    | { compositionId: string; opts?: Record<string, unknown> }
    | { composition: Omit<VideoComposition, "id">; opts?: Record<string, unknown> }
  ): Promise<{ jobId: string }>;

  /** Generative path (fal.ai-style text-to-video). */
  generateFromPrompt(opts: {
    prompt: string;
    durationSeconds?: number;
    aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5";
    model?: string;
  }): Promise<{ jobId: string }>;

  getJob(jobId: string): Promise<RenderJob | null>;
  cancelJob(jobId: string): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}
