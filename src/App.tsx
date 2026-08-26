import { Check, Plus, Save, Trash2, X } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createCover, loadLogoState, saveLogoState } from "./storage";
import { exportLogoPng, renderLogoToCanvas } from "./logoRenderer";
import { multiplyMatrices, normalizeRotation, screenAxisRotation, type Matrix3 } from "./rotation";
import type { CoverLayer, EditableLayer, LogoState } from "./types";

const LONG_PRESS_MS = 480;
const TAP_MOVE_LIMIT = 8;
const DRAG_DEGREES_PER_PIXEL = 0.45;

type LayerSwatchProps = {
  kind: "base" | "cover";
  color?: string;
  alpha?: number;
  cover?: CoverLayer;
  selected?: boolean;
  onTap: () => void;
  onLongPress: () => void;
  ariaLabel: string;
};

type PointerPoint = {
  id: number;
  x: number;
  y: number;
};

export default function App() {
  const [logoState, setLogoState] = useState<LogoState>(() => loadLogoState());
  const [editingLayer, setEditingLayer] = useState<EditableLayer | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [filename, setFilename] = useState("logo.png");
  const [canvasSize, setCanvasSize] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoShellRef = useRef<HTMLDivElement | null>(null);
  const activePointersRef = useRef<Map<number, PointerPoint>>(new Map());
  const lastTwistAngleRef = useRef<number | null>(null);
  const saveInputRef = useRef<HTMLInputElement | null>(null);
  const selectedCoverCount = useMemo(
    () => logoState.covers.filter((cover) => cover.selected).length,
    [logoState.covers],
  );

  useEffect(() => {
    saveLogoState(logoState);
  }, [logoState]);

  useLayoutEffect(() => {
    const shell = logoShellRef.current;

    if (!shell) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setCanvasSize(Math.round(Math.min(entry.contentRect.width, entry.contentRect.height)));
    });

    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || canvasSize <= 0) {
      return;
    }

    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvasSize * scale));
    canvas.height = Math.max(1, Math.round(canvasSize * scale));
    renderLogoToCanvas(canvas, logoState, { transparent: false, padding: 0.08 });
  }, [canvasSize, logoState]);

  useEffect(() => {
    if (!saveModalOpen) {
      return;
    }

    window.setTimeout(() => {
      const input = saveInputRef.current;

      if (input) {
        input.focus();
        input.setSelectionRange(0, filenameStemEnd(input.value));
      }
    }, 0);
  }, [filename, saveModalOpen]);

  const editingCover =
    editingLayer?.kind === "cover"
      ? logoState.covers.find((cover) => cover.id === editingLayer.id) ?? null
      : null;

  const editColor = editingLayer?.kind === "base" ? logoState.base.color : editingCover?.color ?? "#000000";
  const editAlpha = editingLayer?.kind === "base" ? logoState.base.alpha : editingCover?.alpha ?? 1;

  function toggleCoverSelection(id: string) {
    setLogoState((current) => ({
      ...current,
      covers: current.covers.map((cover) =>
        cover.id === id ? { ...cover, selected: !cover.selected } : cover,
      ),
    }));
  }

  function toggleAllCovers() {
    setLogoState((current) => {
      const shouldSelectAll = current.covers.some((cover) => !cover.selected);

      return {
        ...current,
        covers: current.covers.map((cover) => ({ ...cover, selected: shouldSelectAll })),
      };
    });
  }

  function addCover() {
    setLogoState((current) => ({
      ...current,
      covers: [...current.covers, createCover({ selected: true })],
    }));
  }

  function updateEditingColor(color: string) {
    setLogoState((current) => {
      if (editingLayer?.kind === "base") {
        return { ...current, base: { ...current.base, color } };
      }

      if (editingLayer?.kind === "cover") {
        return {
          ...current,
          covers: current.covers.map((cover) => (cover.id === editingLayer.id ? { ...cover, color } : cover)),
        };
      }

      return current;
    });
  }

  function updateEditingAlpha(alpha: number) {
    const boundedAlpha = Math.min(1, Math.max(0, alpha));
    setLogoState((current) => {
      if (editingLayer?.kind === "base") {
        return { ...current, base: { ...current.base, alpha: boundedAlpha } };
      }

      if (editingLayer?.kind === "cover") {
        return {
          ...current,
          covers: current.covers.map((cover) =>
            cover.id === editingLayer.id ? { ...cover, alpha: boundedAlpha } : cover,
          ),
        };
      }

      return current;
    });
  }

  function deleteEditingCover() {
    if (editingLayer?.kind !== "cover") {
      return;
    }

    setLogoState((current) => ({
      ...current,
      covers: current.covers.filter((cover) => cover.id !== editingLayer.id),
    }));
    setEditingLayer(null);
  }

  function rotateSelected(deltaRotation: Matrix3) {
    setLogoState((current) => {
      if (!current.covers.some((cover) => cover.selected)) {
        return current;
      }

      return {
        ...current,
        covers: current.covers.map((cover) =>
          cover.selected
            ? {
                ...cover,
                rotation: normalizeRotation(multiplyMatrices(deltaRotation, cover.rotation)),
              }
            : cover,
        ),
      };
    });
  }

  function handleLogoPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (selectedCoverCount === 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });

    if (activePointersRef.current.size === 2) {
      lastTwistAngleRef.current = twistAngle([...activePointersRef.current.values()]);
    }
  }

  function handleLogoPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const pointer = activePointersRef.current.get(event.pointerId);

    if (!pointer || selectedCoverCount === 0) {
      return;
    }

    activePointersRef.current.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });

    const activePointers = [...activePointersRef.current.values()];

    if (activePointers.length >= 2) {
      const nextAngle = twistAngle(activePointers);
      const previousAngle = lastTwistAngleRef.current ?? nextAngle;
      lastTwistAngleRef.current = nextAngle;
      rotateSelected(screenAxisRotation({ zDegrees: -radiansToDegrees(shortestAngleDelta(previousAngle, nextAngle)) }));
      return;
    }

    const deltaX = event.clientX - pointer.x;
    const deltaY = event.clientY - pointer.y;

    if (event.shiftKey) {
      const previousAngle = pointerAngleAroundElement(event.currentTarget, pointer);
      const nextAngle = pointerAngleAroundElement(event.currentTarget, { x: event.clientX, y: event.clientY });
      rotateSelected(screenAxisRotation({ zDegrees: -radiansToDegrees(shortestAngleDelta(previousAngle, nextAngle)) }));
    } else {
      rotateSelected(screenAxisRotation({
        xDegrees: deltaY * DRAG_DEGREES_PER_PIXEL,
        yDegrees: deltaX * DRAG_DEGREES_PER_PIXEL,
      }));
    }
  }

  function handleLogoPointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    activePointersRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (activePointersRef.current.size < 2) {
      lastTwistAngleRef.current = null;
    }
  }

  function openSaveModal() {
    setFilename("logo.png");
    setSaveModalOpen(true);
  }

  async function saveLogo() {
    const blob = await exportLogoPng(logoState);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameWithPng(filename);
    link.click();
    URL.revokeObjectURL(url);
    setSaveModalOpen(false);
  }

  return (
    <main className="app-shell">
      <div className="layer-row" aria-label="Layers">
        <LayerSwatch
          kind="base"
          color={logoState.base.color}
          alpha={logoState.base.alpha}
          onTap={toggleAllCovers}
          onLongPress={() => setEditingLayer({ kind: "base" })}
          ariaLabel="Base sphere"
        />
        {logoState.covers.map((cover, index) => (
          <LayerSwatch
            key={cover.id}
            kind="cover"
            cover={cover}
            selected={cover.selected}
            onTap={() => toggleCoverSelection(cover.id)}
            onLongPress={() => setEditingLayer({ kind: "cover", id: cover.id })}
            ariaLabel={`Cover ${index + 1}`}
          />
        ))}
        <button className="icon-button layer-add" type="button" onClick={addCover} aria-label="Add cover">
          <Plus aria-hidden="true" size={24} strokeWidth={2.5} />
        </button>
      </div>

      <section className="logo-zone" aria-label="Logo preview">
        <div className="logo-shell" ref={logoShellRef}>
          <canvas
            ref={canvasRef}
            className="logo-canvas"
            data-logo-canvas
            aria-label="Logo"
            onPointerDown={handleLogoPointerDown}
            onPointerMove={handleLogoPointerMove}
            onPointerUp={handleLogoPointerEnd}
            onPointerCancel={handleLogoPointerEnd}
          />
        </div>
      </section>

      <button className="icon-button save-button" type="button" onClick={openSaveModal} aria-label="Save logo">
        <Save aria-hidden="true" size={24} strokeWidth={2.35} />
      </button>

      {editingLayer && (
        <div className="modal-layer">
          <div className="tool-modal color-modal" role="dialog" aria-label="Layer color">
            <button className="modal-close icon-button" type="button" onClick={() => setEditingLayer(null)} aria-label="Close">
              <X aria-hidden="true" size={19} strokeWidth={2.5} />
            </button>
            <label
              className="color-input-shell"
              style={{ "--edit-color": editColor, "--edit-alpha": editAlpha } as CSSProperties}
            >
              <input
                className="color-input"
                type="color"
                value={editColor}
                onChange={(event) => updateEditingColor(event.target.value)}
                aria-label="Color"
              />
            </label>
            <input
              className="alpha-input"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={editAlpha}
              onChange={(event) => updateEditingAlpha(Number(event.target.value))}
              aria-label="Alpha"
            />
            {editingLayer.kind === "cover" && (
              <button className="trash-button icon-button" type="button" onClick={deleteEditingCover} aria-label="Delete cover">
                <Trash2 aria-hidden="true" size={23} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      )}

      {saveModalOpen && (
        <div className="modal-layer">
          <div className="tool-modal save-modal" role="dialog" aria-label="Save">
            <button className="modal-close icon-button" type="button" onClick={() => setSaveModalOpen(false)} aria-label="Close">
              <X aria-hidden="true" size={19} strokeWidth={2.5} />
            </button>
            <input
              ref={saveInputRef}
              className="filename-input"
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              aria-label="Filename"
            />
            <button className="confirm-button icon-button" type="button" onClick={saveLogo} aria-label="Confirm">
              <Check aria-hidden="true" size={25} strokeWidth={2.7} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function LayerSwatch({
  kind,
  color = "#ffffff",
  alpha = 1,
  cover,
  selected = false,
  onTap,
  onLongPress,
  ariaLabel,
}: LayerSwatchProps) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = previewCanvasRef.current;

    if (!canvas || kind !== "cover" || !cover) {
      return;
    }

    const size = Math.max(1, Math.round((canvas.clientWidth || 52) * (window.devicePixelRatio || 1)));
    canvas.width = size;
    canvas.height = size;
    renderLogoToCanvas(canvas, { base: { color: "#ffffff", alpha: 0 }, covers: [{ ...cover, selected: false }] }, { transparent: true, padding: 0.1 });
  }, [cover, kind]);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, y: event.clientY };
    longPressedRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = startRef.current;

    if (!start) {
      return;
    }

    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_MOVE_LIMIT) {
      clearTimer();
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = startRef.current;
    const wasLongPress = longPressedRef.current;
    clearTimer();
    startRef.current = null;
    longPressedRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (!wasLongPress && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= TAP_MOVE_LIMIT) {
      onTap();
    }
  }

  return (
    <button
      className={`${kind === "base" ? "layer-swatch base-swatch" : "layer-swatch cover-swatch"}${selected ? " selected" : ""}`}
      type="button"
      aria-label={ariaLabel}
      style={{ "--swatch-color": color, "--swatch-alpha": alpha } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {kind === "cover" ? <canvas ref={previewCanvasRef} aria-hidden="true" /> : <span aria-hidden="true" />}
    </button>
  );
}

function twistAngle(points: PointerPoint[]): number {
  const [first, second] = points;
  return Math.atan2(second.y - first.y, second.x - first.x);
}

function pointerAngleAroundElement(element: HTMLElement, point: Pick<PointerPoint, "x" | "y">): number {
  const rect = element.getBoundingClientRect();
  return Math.atan2(point.y - (rect.top + rect.height / 2), point.x - (rect.left + rect.width / 2));
}

function shortestAngleDelta(previous: number, next: number): number {
  return Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function filenameStemEnd(value: string): number {
  return value.toLowerCase().endsWith(".png") ? value.length - 4 : value.length;
}

function filenameWithPng(value: string): string {
  const trimmed = value.trim() || "logo.png";
  return trimmed.toLowerCase().endsWith(".png") ? trimmed : `${trimmed}.png`;
}
