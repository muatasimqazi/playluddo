import { BRAND } from "@/lib/brand";

/**
 * Highlight clips (docs/COMPETITIVE_ROADMAP.md F4.3). Records the 3D board
 * canvas to a short video with a branded end card, for sharing a capture or a
 * finish. Only the WebGL canvas is captured — never camera textures or call
 * audio (R5) — and the result stays on the device unless the player shares it.
 */

export interface ClipOptions {
  /** The live WebGL canvas to record. */
  source: HTMLCanvasElement;
  /** Total clip length, clamped to the 6–10s the roadmap calls for. */
  durationMs?: number;
  /** The headline shown on the closing card, e.g. "Ada captured a piece". */
  caption?: string;
}

export function mediaRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

function pickMimeType(): string | undefined {
  const candidates = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function drawEndCard(ctx: CanvasRenderingContext2D, w: number, h: number, caption: string) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#2c3d31");
  grad.addColorStop(1, "#16221a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";

  ctx.fillStyle = "#dcca9f";
  ctx.font = `600 ${Math.round(h * 0.05)}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(BRAND.name.toUpperCase(), w / 2, h * 0.42);

  ctx.fillStyle = "#f3f4e8";
  ctx.font = `700 ${Math.round(h * 0.07)}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(caption.slice(0, 42), w / 2, h * 0.54);

  ctx.fillStyle = "#8f9a86";
  ctx.font = `400 ${Math.round(h * 0.035)}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(BRAND.url.replace(/^https?:\/\//, ""), w / 2, h * 0.64);
}

/**
 * Records `source` for `durationMs`, ending on a ~1.4s branded card, and
 * resolves the recorded video Blob. Rejects if recording isn't supported.
 */
export function recordHighlight({
  source,
  durationMs = 8000,
  caption = "Highlight",
}: ClipOptions): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!mediaRecordingSupported()) {
      reject(new Error("Recording isn't supported on this device."));
      return;
    }
    const total = Math.min(10000, Math.max(6000, durationMs));
    const endCardMs = 1400;
    // Cap dimensions so the clip stays a reasonable size on phones.
    const scale = Math.min(1, 720 / Math.max(source.width, source.height));
    const w = Math.max(2, Math.round(source.width * scale));
    const h = Math.max(2, Math.round(source.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Could not start recording."));
      return;
    }

    const stream = canvas.captureStream(30);
    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Could not start recording."));
      return;
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error("Recording failed."));
    };
    recorder.onstop = () => {
      cleanup();
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };

    const start = performance.now();
    let raf = 0;
    function frame(now: number) {
      const elapsed = now - start;
      if (elapsed >= total - endCardMs) {
        drawEndCard(ctx!, w, h, caption);
      } else {
        try {
          ctx!.drawImage(source, 0, 0, w, h);
        } catch {
          // A transient draw failure (e.g. context lost) — skip this frame.
        }
      }
      if (elapsed >= total) {
        if (recorder.state !== "inactive") recorder.stop();
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    function cleanup() {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
    }

    recorder.start();
    raf = requestAnimationFrame(frame);
  });
}

/**
 * Shares a recorded clip, falling back to a download when sharing is
 * unavailable. Says which one happened (for the `share` event).
 */
export async function shareClip(blob: Blob, caption: string): Promise<"share_sheet" | "download"> {
  const extension = blob.type.includes("mp4") ? "mp4" : "webm";
  const file = new File([blob], `luddo-highlight.${extension}`, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text: `${caption} · ${BRAND.name}` });
    return "share_sheet";
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
  return "download";
}
