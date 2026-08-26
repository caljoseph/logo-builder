import { Check, Plus, Save, Trash2, X } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createCover, loadLogoState, saveLogoState } from "./storage";
import { exportLogoPng, renderLogoToCanvas } from "./logoRenderer";
import { isLatticeEnabled } from "./icosphere";
import {
  eulerToMatrix,
  inverseRotation,
  matrixToEuler,
  multiplyMatrices,
  normalizeRotation,
  screenAxisRotation,
  type EulerAngles,
  type Matrix3,
} from "./rotation";
import type { CoverLayer, EditableLayer, LatticeResolution, LogoState } from "./types";

const LONG_PRESS_MS = 480;
const TAP_MOVE_LIMIT = 8;
const DRAG_DEGREES_PER_PIXEL = 0.45;
const EULER_FIELDS = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
] as const;
const BLANK_EULER_DRAFTS = { roll: "", pitch: "", yaw: "" };
const LATTICE_OPTIONS = ["none", 20, 80, 320, 1280, 5120] as const;
const LINE_WIDTH_MIN = 1;
const LINE_WIDTH_MAX = 12;
const DEFAULT_PREVIEW_SIZE = 52;

type EulerField = (typeof EULER_FIELDS)[number]["key"];

type LayerSwatchProps = {
  kind: "base" | "cover" | "lattice";
  color?: string;
  alpha?: number;
  cover?: CoverLayer;
  previewState?: LogoState;
  selected?: boolean;
  onTap: () => void;
  onLongPress: () => void;
  ariaLabel: string;
  layerKey?: string;
};

type PointerPoint = {
  id: number;
  x: number;
  y: number;
};

type EulerDisplayOverride = {
  layerKey: string;
  rotation: Matrix3;
  values: EulerAngles;
};

type RotatableLayerRef =
  | { kind: "baseLattice"; key: string; rotation: Matrix3 }
  | { kind: "cover"; key: string; id: string; rotation: Matrix3 }
  | { kind: "coverLattice"; key: string; id: string; rotation: Matrix3 };

export default function App() {
  const [logoState, setLogoState] = useState<LogoState>(() => loadLogoState());
  const [editingLayer, setEditingLayer] = useState<EditableLayer | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [filename, setFilename] = useState("logo.png");
  const [canvasSize, setCanvasSize] = useState(0);
  const [activeEulerField, setActiveEulerField] = useState<EulerField | null>(null);
  const [eulerDrafts, setEulerDrafts] = useState<Record<EulerField, string>>(BLANK_EULER_DRAFTS);
  const [eulerDisplayOverride, setEulerDisplayOverride] = useState<EulerDisplayOverride | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoShellRef = useRef<HTMLDivElement | null>(null);
  const activePointersRef = useRef<Map<number, PointerPoint>>(new Map());
  const lastTwistAngleRef = useRef<number | null>(null);
  const saveInputRef = useRef<HTMLInputElement | null>(null);
  const selectedRotatableLayers = useMemo(() => rotatableLayers(logoState).filter((layer) => isLayerSelected(logoState, layer)), [logoState]);
  const selectedReferenceLayer = selectedRotatableLayers[0] ?? null;
  const referenceEuler = useMemo(() => {
    if (!selectedReferenceLayer) {
      return null;
    }

    if (
      eulerDisplayOverride?.layerKey === selectedReferenceLayer.key &&
      matricesAreClose(eulerDisplayOverride.rotation, selectedReferenceLayer.rotation)
    ) {
      return eulerDisplayOverride.values;
    }

    return matrixToEuler(selectedReferenceLayer.rotation);
  }, [eulerDisplayOverride, selectedReferenceLayer]);
  const eulerDisplayValues = useMemo(
    () => ({
      roll: referenceEuler ? formatEulerAngle(referenceEuler.roll) : "",
      pitch: referenceEuler ? formatEulerAngle(referenceEuler.pitch) : "",
      yaw: referenceEuler ? formatEulerAngle(referenceEuler.yaw) : "",
    }),
    [referenceEuler],
  );

  useEffect(() => {
    saveLogoState(logoState);
  }, [logoState]);

  useEffect(() => {
    if (!selectedReferenceLayer) {
      setActiveEulerField(null);
      setEulerDrafts(BLANK_EULER_DRAFTS);
      return;
    }

    if (!activeEulerField) {
      setEulerDrafts(eulerDisplayValues);
    }
  }, [activeEulerField, eulerDisplayValues, selectedReferenceLayer]);

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
  const editLatticeResolution =
    editingLayer?.kind === "base" ? logoState.base.latticeResolution : editingCover?.latticeResolution ?? "none";
  const editLineWidth = editingLayer?.kind === "base" ? logoState.base.lineWidth : editingCover?.lineWidth ?? 3;

  function toggleCoverSelection(id: string) {
    setLogoState((current) => ({
      ...current,
      covers: current.covers.map((cover) =>
        cover.id === id ? { ...cover, selected: !cover.selected } : cover,
      ),
    }));
  }

  function toggleLatticeSelection(kind: "base" | "cover", id?: string) {
    setLogoState((current) => {
      if (kind === "base") {
        if (!isLatticeEnabled(current.base.latticeResolution)) {
          return current;
        }

        return { ...current, base: { ...current.base, latticeSelected: !current.base.latticeSelected } };
      }

      return {
        ...current,
        covers: current.covers.map((cover) =>
          cover.id === id && isLatticeEnabled(cover.latticeResolution)
            ? { ...cover, latticeSelected: !cover.latticeSelected }
            : cover,
        ),
      };
    });
  }

  function toggleAllRotatableLayers() {
    setLogoState((current) => {
      const layers = rotatableLayers(current);
      const shouldSelectAll = layers.some((layer) => !isLayerSelected(current, layer));

      return {
        ...current,
        base: {
          ...current.base,
          latticeSelected: isLatticeEnabled(current.base.latticeResolution) ? shouldSelectAll : false,
        },
        covers: current.covers.map((cover) => ({
          ...cover,
          selected: shouldSelectAll,
          latticeSelected: isLatticeEnabled(cover.latticeResolution) ? shouldSelectAll : false,
        })),
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

  function updateEditingLineWidth(lineWidth: number) {
    const boundedLineWidth = clamp(lineWidth, LINE_WIDTH_MIN, LINE_WIDTH_MAX);
    setLogoState((current) => {
      if (editingLayer?.kind === "base") {
        return { ...current, base: { ...current.base, lineWidth: boundedLineWidth } };
      }

      if (editingLayer?.kind === "cover") {
        return {
          ...current,
          covers: current.covers.map((cover) =>
            cover.id === editingLayer.id ? { ...cover, lineWidth: boundedLineWidth } : cover,
          ),
        };
      }

      return current;
    });
  }

  function updateEditingLatticeResolution(value: string) {
    const nextResolution = parseLatticeResolution(value);

    setLogoState((current) => {
      if (editingLayer?.kind === "base") {
        const wasDisabled = !isLatticeEnabled(current.base.latticeResolution);
        const isEnabled = isLatticeEnabled(nextResolution);

        return {
          ...current,
          base: {
            ...current.base,
            latticeResolution: nextResolution,
            latticeSelected: isEnabled ? (wasDisabled ? true : current.base.latticeSelected) : false,
          },
        };
      }

      if (editingLayer?.kind === "cover") {
        return {
          ...current,
          covers: current.covers.map((cover) => {
            if (cover.id !== editingLayer.id) {
              return cover;
            }

            const wasDisabled = !isLatticeEnabled(cover.latticeResolution);
            const isEnabled = isLatticeEnabled(nextResolution);

            return {
              ...cover,
              selected: isEnabled && wasDisabled ? true : cover.selected,
              latticeResolution: nextResolution,
              latticeSelected: isEnabled ? (wasDisabled ? true : cover.latticeSelected) : false,
            };
          }),
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
    setEulerDisplayOverride(null);
    setLogoState((current) => {
      if (rotatableLayers(current).every((layer) => !isLayerSelected(current, layer))) {
        return current;
      }

      return {
        ...current,
        base: current.base.latticeSelected && isLatticeEnabled(current.base.latticeResolution)
          ? {
              ...current.base,
              latticeRotation: normalizeRotation(multiplyMatrices(deltaRotation, current.base.latticeRotation)),
            }
          : current.base,
        covers: current.covers.map((cover) => ({
          ...cover,
          rotation: cover.selected
            ? normalizeRotation(multiplyMatrices(deltaRotation, cover.rotation))
            : cover.rotation,
          latticeRotation: cover.latticeSelected && isLatticeEnabled(cover.latticeResolution)
            ? normalizeRotation(multiplyMatrices(deltaRotation, cover.latticeRotation))
            : cover.latticeRotation,
        })),
      };
    });
  }

  function commitEulerField(field: EulerField, rawValue: string) {
    const trimmedValue = rawValue.trim();
    const parsed = Number(trimmedValue);

    if (!selectedReferenceLayer || trimmedValue === "" || !Number.isFinite(parsed)) {
      setActiveEulerField(null);
      setEulerDrafts(eulerDisplayValues);
      return;
    }

    const boundedValue = clamp(parsed, 0, 360);
    const currentEuler = matrixToEuler(selectedReferenceLayer.rotation);
    const nextEuler = { ...currentEuler, [field]: boundedValue };
    const targetRotation = normalizeRotation(eulerToMatrix(nextEuler.roll, nextEuler.pitch, nextEuler.yaw));
    const deltaRotation = multiplyMatrices(targetRotation, inverseRotation(selectedReferenceLayer.rotation));

    setLogoState((current) => ({
      ...current,
      base: current.base.latticeSelected && isLatticeEnabled(current.base.latticeResolution)
        ? {
            ...current.base,
            latticeRotation: normalizeRotation(multiplyMatrices(deltaRotation, current.base.latticeRotation)),
          }
        : current.base,
      covers: current.covers.map((cover) => ({
        ...cover,
        rotation: cover.selected
          ? normalizeRotation(multiplyMatrices(deltaRotation, cover.rotation))
          : cover.rotation,
        latticeRotation: cover.latticeSelected && isLatticeEnabled(cover.latticeResolution)
          ? normalizeRotation(multiplyMatrices(deltaRotation, cover.latticeRotation))
          : cover.latticeRotation,
      })),
    }));
    setEulerDisplayOverride({
      layerKey: selectedReferenceLayer.key,
      rotation: targetRotation,
      values: nextEuler,
    });
    setActiveEulerField(null);
  }

  function handleEulerFocus(field: EulerField) {
    if (!selectedReferenceLayer) {
      return;
    }

    setActiveEulerField(field);
    setEulerDrafts((current) => ({ ...current, [field]: eulerDisplayValues[field] }));
  }

  function handleEulerChange(field: EulerField, value: string) {
    setEulerDrafts((current) => ({ ...current, [field]: value }));
  }

  function handleEulerBlur(field: EulerField) {
    commitEulerField(field, eulerDrafts[field]);
  }

  function handleEulerKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function handleLogoPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (selectedRotatableLayers.length === 0) {
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

    if (!pointer || selectedRotatableLayers.length === 0) {
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
      rotateSelected(twistToScreenRotation(previousAngle, nextAngle));
      return;
    }

    const deltaX = event.clientX - pointer.x;
    const deltaY = event.clientY - pointer.y;

    if (event.shiftKey) {
      rotateSelected(shiftDragToScreenRotation(event.currentTarget, pointer, { x: event.clientX, y: event.clientY }));
    } else {
      rotateSelected(dragToScreenRotation(deltaX, deltaY));
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
          onTap={toggleAllRotatableLayers}
          onLongPress={() => setEditingLayer({ kind: "base" })}
          ariaLabel="Base sphere"
          layerKey="base"
        />
        {isLatticeEnabled(logoState.base.latticeResolution) && (
          <LayerSwatch
            kind="lattice"
            previewState={{ ...logoState, covers: [] }}
            selected={logoState.base.latticeSelected}
            onTap={() => toggleLatticeSelection("base")}
            onLongPress={() => undefined}
            ariaLabel="Base lattice"
            layerKey="base-lattice"
          />
        )}
        {logoState.covers.map((cover, index) => (
          <Fragment key={cover.id}>
            <LayerSwatch
              kind="cover"
              cover={{ ...cover, latticeResolution: "none", latticeSelected: false }}
              selected={cover.selected}
              onTap={() => toggleCoverSelection(cover.id)}
              onLongPress={() => setEditingLayer({ kind: "cover", id: cover.id })}
              ariaLabel={`Cover ${index + 1}`}
              layerKey={`cover-${cover.id}`}
            />
            {isLatticeEnabled(cover.latticeResolution) && (
              <LayerSwatch
                kind="lattice"
                previewState={{
                  base: { ...logoState.base, alpha: 0, latticeResolution: "none", latticeSelected: false },
                  covers: [{ ...cover, selected: false }],
                }}
                selected={cover.latticeSelected}
                onTap={() => toggleLatticeSelection("cover", cover.id)}
                onLongPress={() => undefined}
                ariaLabel={`Cover ${index + 1} lattice`}
                layerKey={`cover-lattice-${cover.id}`}
              />
            )}
          </Fragment>
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

      {!editingLayer && !saveModalOpen && (
        <div className="euler-controls" aria-label="Euler rotation">
          {EULER_FIELDS.map(({ key, label }) => (
            <label key={key} className="euler-field">
              <span>{label}</span>
              <input
                type="text"
                inputMode="decimal"
                value={selectedReferenceLayer ? (activeEulerField === key ? eulerDrafts[key] : eulerDisplayValues[key]) : ""}
                disabled={!selectedReferenceLayer}
                onFocus={() => handleEulerFocus(key)}
                onChange={(event) => handleEulerChange(key, event.target.value)}
                onBlur={() => handleEulerBlur(key)}
                onKeyDown={handleEulerKeyDown}
                aria-label={label}
              />
            </label>
          ))}
        </div>
      )}

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
            <select
              className="lattice-select"
              value={String(editLatticeResolution)}
              onChange={(event) => updateEditingLatticeResolution(event.target.value)}
              aria-label="Lattice"
            >
              {LATTICE_OPTIONS.map((option) => (
                <option key={option} value={String(option)}>
                  {option === "none" ? "None" : option}
                </option>
              ))}
            </select>
            <input
              className="line-width-input"
              type="range"
              min={LINE_WIDTH_MIN}
              max={LINE_WIDTH_MAX}
              step="0.1"
              value={editLineWidth}
              disabled={!isLatticeEnabled(editLatticeResolution)}
              onChange={(event) => updateEditingLineWidth(Number(event.target.value))}
              aria-label="Line width"
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
  previewState,
  selected = false,
  onTap,
  onLongPress,
  ariaLabel,
  layerKey,
}: LayerSwatchProps) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = previewCanvasRef.current;

    if (!canvas || kind === "base") {
      return;
    }

    const size = Math.max(1, Math.round((canvas.clientWidth || DEFAULT_PREVIEW_SIZE) * (window.devicePixelRatio || 1)));
    canvas.width = size;
    canvas.height = size;

    if (kind === "cover" && cover) {
      renderLogoToCanvas(canvas, {
        base: invisibleBase(),
        covers: [{ ...cover, selected: false, latticeResolution: "none", latticeSelected: false }],
      }, { transparent: true, padding: 0.1 });
    }

    if (kind === "lattice" && previewState) {
      renderLogoToCanvas(canvas, previewState, { transparent: true, padding: 0.1 });
    }
  }, [cover, kind, previewState]);

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
      className={`${kind === "base" ? "layer-swatch base-swatch" : "layer-swatch cover-swatch"}${kind === "lattice" ? " lattice-swatch" : ""}${selected ? " selected" : ""}`}
      type="button"
      aria-label={ariaLabel}
      data-layer-key={layerKey}
      data-layer-kind={kind}
      style={{ "--swatch-color": color, "--swatch-alpha": alpha } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {kind === "base" ? <span aria-hidden="true" /> : <canvas ref={previewCanvasRef} aria-hidden="true" />}
    </button>
  );
}

function rotatableLayers(state: LogoState): RotatableLayerRef[] {
  return [
    ...(isLatticeEnabled(state.base.latticeResolution)
      ? [{ kind: "baseLattice" as const, key: "base-lattice", rotation: state.base.latticeRotation }]
      : []),
    ...state.covers.flatMap((cover) => [
      { kind: "cover" as const, key: `cover-${cover.id}`, id: cover.id, rotation: cover.rotation },
      ...(isLatticeEnabled(cover.latticeResolution)
        ? [{ kind: "coverLattice" as const, key: `cover-lattice-${cover.id}`, id: cover.id, rotation: cover.latticeRotation }]
        : []),
    ]),
  ];
}

function isLayerSelected(state: LogoState, layer: RotatableLayerRef): boolean {
  if (layer.kind === "baseLattice") {
    return isLatticeEnabled(state.base.latticeResolution) && state.base.latticeSelected;
  }

  const cover = state.covers.find((candidate) => candidate.id === layer.id);

  if (!cover) {
    return false;
  }

  return layer.kind === "cover"
    ? cover.selected
    : isLatticeEnabled(cover.latticeResolution) && cover.latticeSelected;
}

function parseLatticeResolution(value: string): LatticeResolution {
  if (value === "none") {
    return "none";
  }

  const parsed = Number(value);
  return LATTICE_OPTIONS.includes(parsed as (typeof LATTICE_OPTIONS)[number])
    ? (parsed as LatticeResolution)
    : "none";
}

function invisibleBase(): LogoState["base"] {
  return {
    color: "#ffffff",
    alpha: 0,
    latticeResolution: "none",
    lineWidth: 3,
    latticeRotation: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    latticeSelected: false,
  };
}

function twistAngle(points: PointerPoint[]): number {
  const [first, second] = points;
  return Math.atan2(second.y - first.y, second.x - first.x);
}

function dragToScreenRotation(deltaX: number, deltaY: number): Matrix3 {
  // Single-pointer movement is one screen-space axis-angle update with no z component.
  return screenAxisRotation({
    xDegrees: deltaY * DRAG_DEGREES_PER_PIXEL,
    yDegrees: deltaX * DRAG_DEGREES_PER_PIXEL,
  });
}

function twistToScreenRotation(previousAngle: number, nextAngle: number): Matrix3 {
  return screenAxisRotation({ zDegrees: radiansToDegrees(shortestAngleDelta(previousAngle, nextAngle)) });
}

function shiftDragToScreenRotation(
  element: HTMLElement,
  previousPoint: Pick<PointerPoint, "x" | "y">,
  nextPoint: Pick<PointerPoint, "x" | "y">,
): Matrix3 {
  return twistToScreenRotation(
    pointerAngleAroundElement(element, previousPoint),
    pointerAngleAroundElement(element, nextPoint),
  );
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatEulerAngle(value: number): string {
  return clamp(value, 0, 360).toFixed(1);
}

function matricesAreClose(first: Matrix3, second: Matrix3): boolean {
  return first.every((row, rowIndex) =>
    row.every((value, columnIndex) => Math.abs(value - second[rowIndex][columnIndex]) < 0.000_001),
  );
}

function filenameStemEnd(value: string): number {
  return value.toLowerCase().endsWith(".png") ? value.length - 4 : value.length;
}

function filenameWithPng(value: string): string {
  const trimmed = value.trim() || "logo.png";
  return trimmed.toLowerCase().endsWith(".png") ? trimmed : `${trimmed}.png`;
}
