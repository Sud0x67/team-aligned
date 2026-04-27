import { useId, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { createTranslator } from "../i18n";
import { useAppStore } from "../store/use-app-store";
import { AvatarBadge } from "./avatar-badge";

type CropEditorState = {
  dataUrl: string;
  fileNameHint: string;
  width: number;
  height: number;
};

type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
};

const CROP_PREVIEW_SIZE = 256;

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = dataUrl;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCropMetrics(input: {
  width: number;
  height: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}) {
  if (
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    return {
      cropSize: 1,
      maxX: 0,
      maxY: 0,
      sx: 0,
      sy: 0,
      imageWidth: CROP_PREVIEW_SIZE,
      imageHeight: CROP_PREVIEW_SIZE,
      imageX: 0,
      imageY: 0,
    };
  }
  const zoom = clamp(input.zoom, 1, 3);
  const cropSize = Math.min(input.width, input.height) / zoom;
  const maxX = Math.max(0, input.width - cropSize);
  const maxY = Math.max(0, input.height - cropSize);
  const sx = clamp(maxX / 2 + (input.offsetX / 100) * (maxX / 2), 0, maxX);
  const sy = clamp(maxY / 2 + (input.offsetY / 100) * (maxY / 2), 0, maxY);

  return {
    cropSize,
    maxX,
    maxY,
    sx,
    sy,
    imageWidth: (input.width / cropSize) * CROP_PREVIEW_SIZE,
    imageHeight: (input.height / cropSize) * CROP_PREVIEW_SIZE,
    imageX: -(sx / cropSize) * CROP_PREVIEW_SIZE,
    imageY: -(sy / cropSize) * CROP_PREVIEW_SIZE,
  };
}

async function cropAvatarImage(input: {
  dataUrl: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
}) {
  const image = await loadImage(input.dataUrl);
  if (
    !Number.isFinite(image.naturalWidth) ||
    !Number.isFinite(image.naturalHeight) ||
    image.naturalWidth <= 0 ||
    image.naturalHeight <= 0
  ) {
    throw new Error("Invalid image dimensions");
  }
  const metrics = getCropMetrics({
    width: image.naturalWidth,
    height: image.naturalHeight,
    zoom: input.zoom,
    offsetX: input.offsetX,
    offsetY: input.offsetY,
  });

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas unavailable");
  }

  context.drawImage(
    image,
    metrics.sx,
    metrics.sy,
    metrics.cropSize,
    metrics.cropSize,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/png", 0.92);
}

export function AvatarPicker({
  label,
  value,
  fallback,
  color,
  uploadLabel,
  removeLabel,
  scope,
  fileNameHint,
  onChange,
}: {
  label: string;
  value: string | null;
  fallback: string;
  color: string;
  uploadLabel: string;
  removeLabel: string;
  scope: "profile" | "agents" | "teams";
  fileNameHint?: string;
  onChange: (value: string | null) => void;
}) {
  const inputId = useId();
  const dragRef = useRef<DragState | null>(null);
  const language = useAppStore((state) => state.settings.language);
  const t = createTranslator(language);
  const [editor, setEditor] = useState<CropEditorState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewMetrics = useMemo(
    () =>
      editor
        ? getCropMetrics({
            width: editor.width,
            height: editor.height,
            zoom,
            offsetX,
            offsetY,
          })
        : null,
    [editor, offsetX, offsetY, zoom],
  );

  const closeEditor = () => {
    setEditor(null);
    dragRef.current = null;
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
    setSaving(false);
  };

  const pickFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError(t.common("avatarInvalidFile"));
      return;
    }

    setError(null);
    const dataUrl = await fileToDataUrl(file);
    const image = await loadImage(dataUrl);
    setEditor({
      dataUrl,
      fileNameHint: fileNameHint || file.name.replace(/\.[^.]+$/, ""),
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  };

  const saveCrop = async () => {
    if (!editor || saving) return;
    setSaving(true);
    setError(null);
    try {
      const dataUrl = await cropAvatarImage({
        dataUrl: editor.dataUrl,
        zoom,
        offsetX,
        offsetY,
      });
      const assetPath = await window.teamaligned.saveAvatarAsset({
        scope,
        dataUrl,
        fileNameHint: editor.fileNameHint || fileNameHint || scope,
      });
      onChange(assetPath);
      closeEditor();
    } catch {
      setSaving(false);
      setError(t.common("avatarUploadFailed"));
    }
  };

  const updateDragOffset = (event: PointerEvent<HTMLDivElement>) => {
    if (!editor || !dragRef.current) return;
    const drag = dragRef.current;
    const metrics = getCropMetrics({
      width: editor.width,
      height: editor.height,
      zoom,
      offsetX: drag.startOffsetX,
      offsetY: drag.startOffsetY,
    });
    const deltaSourceX = -((event.clientX - drag.startClientX) * metrics.cropSize) / CROP_PREVIEW_SIZE;
    const deltaSourceY = -((event.clientY - drag.startClientY) * metrics.cropSize) / CROP_PREVIEW_SIZE;
    const nextOffsetX =
      metrics.maxX > 0 ? drag.startOffsetX + (deltaSourceX / (metrics.maxX / 2)) * 100 : 0;
    const nextOffsetY =
      metrics.maxY > 0 ? drag.startOffsetY + (deltaSourceY / (metrics.maxY / 2)) * 100 : 0;
    setOffsetX(clamp(nextOffsetX, -100, 100));
    setOffsetY(clamp(nextOffsetY, -100, 100));
  };

  return (
    <div className="space-y-2">
      <span className="block text-[13px] text-[var(--muted-foreground)]">{label}</span>
      <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
        <AvatarBadge
          src={value}
          fallback={fallback}
          alt={label}
          className="h-16 w-16 rounded-2xl"
          style={{ backgroundColor: color }}
          textClassName="text-lg font-semibold text-white"
        />
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[13px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            <ImagePlus className="h-4 w-4" />
            {uploadLabel}
          </label>
          {value ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                onChange(null);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <Trash2 className="h-4 w-4" />
              {removeLabel}
            </button>
          ) : null}
          {error ? <p className="basis-full text-[12px] text-red-500">{error}</p> : null}
        </div>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void pickFile(file).catch(() => setError(t.common("avatarUploadFailed")));
          }}
        />
      </div>

      {editor ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[24px] border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-[17px] font-semibold text-[var(--foreground)]">
                  {t.common("avatarCropTitle")}
                </h3>
                <p className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                  {t.common("avatarCropHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div
              className="mx-auto relative h-64 w-64 touch-none select-none overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--background)] cursor-grab active:cursor-grabbing"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = {
                  pointerId: event.pointerId,
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  startOffsetX: offsetX,
                  startOffsetY: offsetY,
                };
              }}
              onPointerMove={updateDragOffset}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) {
                  dragRef.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
              onWheel={(event) => {
                event.preventDefault();
                setZoom((current) => clamp(current + (event.deltaY > 0 ? -0.1 : 0.1), 1, 3));
              }}
            >
              {previewMetrics ? (
                <img
                  src={editor.dataUrl}
                  alt={t.common("avatarCropTitle")}
                  draggable={false}
                  className="absolute left-0 top-0 max-w-none"
                  style={{
                    width: `${previewMetrics.imageWidth}px`,
                    height: `${previewMetrics.imageHeight}px`,
                    transform: `translate3d(${previewMetrics.imageX}px, ${previewMetrics.imageY}px, 0)`,
                  }}
                />
              ) : null}
              <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-2 ring-white/70 ring-inset" />
            </div>

            <div className="mt-5 space-y-4">
              <label className="block space-y-2">
                <span className="text-[12px] text-[var(--muted-foreground)]">
                  {t.common("avatarZoom")}
                </span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="w-full accent-[var(--primary)]"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-[12px] text-[var(--muted-foreground)]">
                  {t.common("avatarHorizontal")}
                </span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={offsetX}
                  onChange={(event) => setOffsetX(Number(event.target.value))}
                  className="w-full accent-[var(--primary)]"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-[12px] text-[var(--muted-foreground)]">
                  {t.common("avatarVertical")}
                </span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={offsetY}
                  onChange={(event) => setOffsetY(Number(event.target.value))}
                  className="w-full accent-[var(--primary)]"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--foreground)] transition hover:bg-[var(--muted)]"
              >
                {t.common("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void saveCrop()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-[14px] font-medium text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {saving ? t.common("avatarSaving") : t.common("avatarApply")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
