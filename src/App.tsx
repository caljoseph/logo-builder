import { Check, ChevronLeft, ChevronRight, Plus, Save, Trash2, X } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createCover, createLatticeFromSource, loadLogoState, saveLogoState } from "./storage";
import { exportLogoPng, renderLogoToCanvas } from "./logoRenderer";
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
import type {
  ColorMode,
  CoverLayer,
  EditableLayer,
  LatticeLayer,
  LatticeResolution,
  LogoState,
  PaintStyle,
  StackItem,
} from "./types";

const LONG_PRESS_MS = 480;
const DOUBLE_PRESS_MS = 300;
const TAP_MOVE_LIMIT = 8;
const DRAG_DEGREES_PER_PIXEL = 0.45;
const EULER_FIELDS = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
] as const;
const BLANK_EULER_DRAFTS = { roll: "", pitch: "", yaw: "" };
const LATTICE_OPTIONS = [20, 80, 320, 1280, 5120] as const;
const LINE_WIDTH_MIN = 1;
const LINE_WIDTH_MAX = 12;
const DOT_SIZE_MIN = 1;
const DOT_SIZE_MAX = 12;
const DEFAULT_PREVIEW_SIZE = 52;

type EulerField = (typeof EULER_FIELDS)[number]["key"];

type LayerSwatchProps = {
  kind: "background" | "base" | "cover" | "lattice";
  paint?: PaintStyle;
  previewState?: LogoState;
  selected?: boolean;
  onTap: () => void;
  onLongPress: () => void;
  ariaLabel: string;
  layerKey?: string;
};

type LatticePreviewCircleProps = {
  lattice: LatticeLayer;
  onColorChange: (color: string) => void;
  onSelectNormal: () => void;
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
  | { kind: "base"; key: string; rotation: Matrix3 }
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
  const selectedRotatableLayers = useMemo(
    () => rotatableLayers(logoState).filter((layer) => isLayerSelected(logoState, layer)),
    [logoState],
  );
  const selectedReferenceLayer = selectedRotatableLayers[0] ?? null;
  const editingPaint = editingLayer ? editablePaint(logoState, editingLayer) : null;
  const editingLattice = editingLayer ? editableLattice(logoState, editingLayer) : null;
  const canMoveLeft = editingLayer ? canMoveLayer(logoState, editingLayer, -1) : false;
  const canMoveRight = editingLayer ? canMoveLayer(logoState, editingLayer, 1) : false;
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
    renderLogoToCanvas(canvas, logoState, { omitBackground: true, padding: 0.08 });
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

  function toggleBaseSelection() {
    setLogoState((current) => ({ ...current, base: { ...current.base, selected: !current.base.selected } }));
  }

  function toggleCoverSelection(id: string) {
    setLogoState((current) => ({
      ...current,
      covers: current.covers.map((cover) => (cover.id === id ? { ...cover, selected: !cover.selected } : cover)),
    }));
  }

  function toggleLatticeSelection(kind: "base" | "cover", id?: string) {
    setLogoState((current) => {
      if (kind === "base") {
        return current.base.lattice
          ? { ...current, base: { ...current.base, lattice: { ...current.base.lattice, selected: !current.base.lattice.selected } } }
          : current;
      }

      return {
        ...current,
        covers: current.covers.map((cover) =>
          cover.id === id && cover.lattice
            ? { ...cover, lattice: { ...cover.lattice, selected: !cover.lattice.selected } }
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
          selected: shouldSelectAll,
          lattice: current.base.lattice ? { ...current.base.lattice, selected: shouldSelectAll } : undefined,
        },
        covers: current.covers.map((cover) => ({
          ...cover,
          selected: shouldSelectAll,
          lattice: cover.lattice ? { ...cover.lattice, selected: shouldSelectAll } : undefined,
        })),
      };
    });
  }

  function addCover() {
    setLogoState((current) => {
      const cover = createCover({ selected: true });

      return {
        ...current,
        covers: [...current.covers, cover],
        stack: [...current.stack, { kind: "cover", id: cover.id }],
      };
    });
  }

  function updateEditingColor(color: string) {
    updateEditablePaint({ color, colorMode: "normal" });
  }

  function updateEditingAlpha(alpha: number) {
    const boundedAlpha = clamp(alpha, 0, 1);
    updateEditablePaint({ alpha: boundedAlpha });
  }

  function updateEditingColorMode(colorMode: ColorMode) {
    updateEditablePaint(colorMode === "knockout" ? { colorMode, alpha: 1 } : { colorMode });
  }

  function updateEditablePaint(patch: Partial<PaintStyle>) {
    if (!editingLayer) {
      return;
    }

    setLogoState((current) => updatePaintForLayer(current, editingLayer, patch));
  }

  function updateEditingLatticeEnabled(enabled: boolean) {
    if (!editingLayer || (editingLayer.kind !== "base" && editingLayer.kind !== "cover")) {
      return;
    }

    setLogoState((current) => {
      if (editingLayer.kind === "base") {
        if (!enabled) {
          return { ...current, base: { ...current.base, lattice: undefined } };
        }

        if (current.base.lattice) {
          return current;
        }

        return {
          ...current,
          base: {
            ...current.base,
            selected: true,
            lattice: createLatticeFromSource(current.base),
          },
        };
      }

      return addOrRemoveCoverLattice(current, editingLayer.id, enabled);
    });
  }

  function updateEditingLatticeResolution(value: string) {
    const resolution = parseLatticeResolution(value);
    updateEditableLattice({ resolution });
  }

  function updateEditingLineWidth(lineWidth: number) {
    updateEditableLattice({ lineWidth: clamp(lineWidth, LINE_WIDTH_MIN, LINE_WIDTH_MAX) });
  }

  function updateEditingShowIntersections(showIntersections: boolean) {
    updateEditableLattice({ showIntersections });
  }

  function updateEditingDotSize(dotSize: number) {
    updateEditableLattice({ dotSize: clamp(dotSize, DOT_SIZE_MIN, DOT_SIZE_MAX) });
  }

  function updateEditableLattice(patch: Partial<LatticeLayer>) {
    if (!editingLayer) {
      return;
    }

    setLogoState((current) => updateLatticeForLayer(current, editingLayer, patch));
  }

  function deleteEditingCover() {
    if (editingLayer?.kind !== "cover") {
      return;
    }

    setLogoState((current) => ({
      ...current,
      covers: current.covers.filter((cover) => cover.id !== editingLayer.id),
      stack: current.stack.filter((item) => item.id !== editingLayer.id),
    }));
    setEditingLayer(null);
  }

  function deleteEditingLattice() {
    if (!editingLayer || (editingLayer.kind !== "baseLattice" && editingLayer.kind !== "coverLattice")) {
      return;
    }

    setLogoState((current) => {
      if (editingLayer.kind === "baseLattice") {
        return { ...current, base: { ...current.base, lattice: undefined } };
      }

      return addOrRemoveCoverLattice(current, editingLayer.id, false);
    });
    setEditingLayer(null);
  }

  function moveEditingLayer(direction: -1 | 1) {
    if (!editingLayer) {
      return;
    }

    setLogoState((current) => moveLayerInStack(current, editingLayer, direction));
  }

  function rotateSelected(deltaRotation: Matrix3) {
    setEulerDisplayOverride(null);
    setLogoState((current) => {
      if (rotatableLayers(current).every((layer) => !isLayerSelected(current, layer))) {
        return current;
      }

      return mapSelectedRotations(current, deltaRotation);
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

    setLogoState((current) => mapSelectedRotations(current, deltaRotation));
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
      <header className="top-panel">
        <div className="layer-row" aria-label="Layers">
          <LayerSwatch
            kind="background"
            paint={logoState.background}
            onTap={toggleAllRotatableLayers}
            onLongPress={() => setEditingLayer({ kind: "background" })}
            ariaLabel="Background"
            layerKey="background"
          />
          <LayerSwatch
            kind="base"
            paint={logoState.base}
            selected={logoState.base.selected}
            onTap={toggleBaseSelection}
            onLongPress={() => setEditingLayer({ kind: "base" })}
            ariaLabel="Base sphere"
            layerKey="base"
          />
          {logoState.base.lattice && (
            <LayerSwatch
              kind="lattice"
              paint={logoState.base.lattice}
              previewState={previewStateForBaseLattice(logoState)}
              selected={logoState.base.lattice.selected}
              onTap={() => toggleLatticeSelection("base")}
              onLongPress={() => setEditingLayer({ kind: "baseLattice" })}
              ariaLabel="Base lattice"
              layerKey="base-lattice"
            />
          )}
          {logoState.stack.map((item) => {
            const cover = findCover(logoState, item);

            if (!cover) {
              return null;
            }

            const coverIndex = logoState.covers.findIndex((candidate) => candidate.id === cover.id) + 1;

            if (item.kind === "cover") {
              return (
                <LayerSwatch
                  key={`cover-${cover.id}`}
                  kind="cover"
                  paint={cover}
                  previewState={previewStateForCover(logoState, cover)}
                  selected={cover.selected}
                  onTap={() => toggleCoverSelection(cover.id)}
                  onLongPress={() => setEditingLayer({ kind: "cover", id: cover.id })}
                  ariaLabel={`Cover ${coverIndex}`}
                  layerKey={`cover-${cover.id}`}
                />
              );
            }

            if (!cover.lattice) {
              return null;
            }

            return (
              <LayerSwatch
                key={`cover-lattice-${cover.id}`}
                kind="lattice"
                paint={cover.lattice}
                previewState={previewStateForCoverLattice(logoState, cover)}
                selected={cover.lattice.selected}
                onTap={() => toggleLatticeSelection("cover", cover.id)}
                onLongPress={() => setEditingLayer({ kind: "coverLattice", id: cover.id })}
                ariaLabel={`Cover ${coverIndex} lattice`}
                layerKey={`cover-lattice-${cover.id}`}
              />
            );
          })}
          <button className="icon-button layer-add" type="button" onClick={addCover} aria-label="Add cover">
            <Plus aria-hidden="true" size={24} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      <section className="logo-zone" style={previewBackgroundStyle(logoState.background)} aria-label="Logo preview">
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

      <footer className="bottom-panel">
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
      </footer>

      {editingLayer && editingPaint && (
        <div className="modal-layer">
          <div
            className={`tool-modal color-modal${editingLattice ? " lattice-modal" : ""}`}
            role="dialog"
            aria-label={editingLattice ? "Lattice color" : "Layer color"}
          >
            <button className="move-button move-left icon-button" type="button" onClick={() => moveEditingLayer(-1)} disabled={!canMoveLeft} aria-label="Move left">
              <ChevronLeft aria-hidden="true" size={21} strokeWidth={2.6} />
            </button>
            <button className="move-button move-right icon-button" type="button" onClick={() => moveEditingLayer(1)} disabled={!canMoveRight} aria-label="Move right">
              <ChevronRight aria-hidden="true" size={21} strokeWidth={2.6} />
            </button>
            <button className="modal-close icon-button" type="button" onClick={() => setEditingLayer(null)} aria-label="Close">
              <X aria-hidden="true" size={19} strokeWidth={2.5} />
            </button>
            <div className="control-group">
              <span className="modal-label">Color</span>
              <div className="paint-controls">
                {editingLattice ? (
                  <LatticePreviewCircle
                    lattice={editingLattice}
                    onColorChange={updateEditingColor}
                    onSelectNormal={() => updateEditingColorMode("normal")}
                  />
                ) : (
                  <label
                    className={`color-input-shell${editingPaint.colorMode === "normal" ? " active" : ""}`}
                    style={{ "--edit-color": editingPaint.color, "--edit-alpha": editingPaint.alpha } as CSSProperties}
                    onPointerDown={() => updateEditingColorMode("normal")}
                  >
                    <input
                      className="color-input"
                      type="color"
                      value={editingPaint.color}
                      onFocus={() => updateEditingColorMode("normal")}
                      onChange={(event) => updateEditingColor(event.target.value)}
                      aria-label="Color"
                    />
                  </label>
                )}
                <button
                  className={`transparent-color-button${editingPaint.colorMode === "knockout" ? " active" : ""}`}
                  type="button"
                  onClick={() => updateEditingColorMode(editingPaint.colorMode === "knockout" ? "normal" : "knockout")}
                  aria-label="Transparent color"
                />
              </div>
            </div>
            <div className="control-group">
              <span className="modal-label">Alpha</span>
              <input
                className="alpha-input"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={editingPaint.alpha}
                disabled={editingPaint.colorMode === "knockout"}
                onChange={(event) => updateEditingAlpha(Number(event.target.value))}
                aria-label="Alpha"
              />
            </div>

            {(editingLayer.kind === "base" || editingLayer.kind === "cover") && (
              <div className="inline-control-group">
                <span className="modal-label">Lattice</span>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={sourceHasLattice(logoState, editingLayer)}
                    onChange={(event) => updateEditingLatticeEnabled(event.target.checked)}
                    aria-label="Lattice"
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
            )}

            {editingLattice && (
              <>
                <div className="control-group">
                  <span className="modal-label">Resolution</span>
                  <select
                    className="lattice-select"
                    value={String(editingLattice.resolution)}
                    onChange={(event) => updateEditingLatticeResolution(event.target.value)}
                    aria-label="Lattice resolution"
                  >
                    {LATTICE_OPTIONS.map((option) => (
                      <option key={option} value={String(option)}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="control-group">
                  <span className="modal-label">Line width</span>
                  <input
                    className="line-width-input"
                    type="range"
                    min={LINE_WIDTH_MIN}
                    max={LINE_WIDTH_MAX}
                    step="0.1"
                    value={editingLattice.lineWidth}
                    onChange={(event) => updateEditingLineWidth(Number(event.target.value))}
                    aria-label="Line width"
                  />
                </div>
                <div className="inline-control-group">
                  <span className="modal-label">Dots</span>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={editingLattice.showIntersections}
                      onChange={(event) => updateEditingShowIntersections(event.target.checked)}
                      aria-label="Intersection points"
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                <div className="control-group">
                  <span className="modal-label">Dot size</span>
                  <input
                    className="dot-size-input"
                    type="range"
                    min={DOT_SIZE_MIN}
                    max={DOT_SIZE_MAX}
                    step="0.1"
                    value={editingLattice.dotSize}
                    disabled={!editingLattice.showIntersections}
                    onChange={(event) => updateEditingDotSize(Number(event.target.value))}
                    aria-label="Dot size"
                  />
                </div>
                <button className="trash-button icon-button" type="button" onClick={deleteEditingLattice} aria-label="Delete lattice">
                  <Trash2 aria-hidden="true" size={23} strokeWidth={2.4} />
                </button>
              </>
            )}

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

function LatticePreviewCircle({ lattice, onColorChange, onSelectNormal }: LatticePreviewCircleProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = previewCanvasRef.current;

    if (!canvas) {
      return;
    }

    const size = 512;
    canvas.width = size;
    canvas.height = size;
    renderLogoToCanvas(canvas, {
      background: { colorMode: "normal", color: "#ffffff", alpha: 0 },
      base: {
        colorMode: "normal",
        color: "#ffffff",
        alpha: 0,
        rotation: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        selected: false,
        lattice: { ...lattice, selected: false },
      },
      covers: [],
      stack: [],
    }, { transparent: true, padding: 0.08 });
  }, [lattice]);

  return (
    <label
      className={`color-input-shell lattice-preview-shell${lattice.colorMode === "normal" ? " active" : ""}`}
      style={{ "--edit-color": lattice.color, "--edit-alpha": lattice.alpha } as CSSProperties}
      onPointerDown={onSelectNormal}
    >
      <canvas ref={previewCanvasRef} className="lattice-preview-canvas" aria-hidden="true" />
      <input
        className="color-input"
        type="color"
        value={lattice.color}
        onFocus={onSelectNormal}
        onChange={(event) => onColorChange(event.target.value)}
        aria-label="Color"
      />
    </label>
  );
}

function previewBackgroundStyle(background: LogoState["background"]): CSSProperties {
  return {
    "--preview-background-color": background.color,
    "--preview-background-alpha": background.colorMode === "normal" ? background.alpha : 0,
  } as CSSProperties;
}

function LayerSwatch({
  kind,
  paint,
  previewState,
  selected = false,
  onTap,
  onLongPress,
  ariaLabel,
  layerKey,
}: LayerSwatchProps) {
  const timerRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef(0);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = previewCanvasRef.current;

    if (!canvas || !previewState) {
      return;
    }

    const size = Math.max(1, Math.round((canvas.clientWidth || DEFAULT_PREVIEW_SIZE) * (window.devicePixelRatio || 1)));
    canvas.width = size;
    canvas.height = size;
    renderLogoToCanvas(canvas, previewState, { transparent: true, padding: 0.1 });
  }, [previewState]);

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
      lastTapTimeRef.current = 0;
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
      const now = window.performance.now();

      if (lastTapTimeRef.current > 0 && now - lastTapTimeRef.current <= DOUBLE_PRESS_MS) {
        lastTapTimeRef.current = 0;
        onTap();
        onLongPress();
      } else {
        lastTapTimeRef.current = now;
        onTap();
      }
    }
  }

  return (
    <button
      className={`layer-swatch ${kind}-swatch${selected ? " selected" : ""}${paint?.colorMode === "knockout" ? " knockout" : ""}`}
      type="button"
      aria-label={ariaLabel}
      data-layer-key={layerKey}
      data-layer-kind={kind}
      style={{ "--swatch-color": paint?.color ?? "#ffffff", "--swatch-alpha": paint?.alpha ?? 1 } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {kind === "background" || kind === "base" ? <span aria-hidden="true" /> : <canvas ref={previewCanvasRef} aria-hidden="true" />}
    </button>
  );
}

function updatePaintForLayer(state: LogoState, layer: EditableLayer, patch: Partial<PaintStyle>): LogoState {
  const normalizePatch = patch.colorMode === "knockout" ? { ...patch, alpha: 1 } : patch;

  if (layer.kind === "background") {
    return { ...state, background: { ...state.background, ...normalizePatch } };
  }

  if (layer.kind === "base") {
    return { ...state, base: { ...state.base, ...normalizePatch } };
  }

  if (layer.kind === "baseLattice" && state.base.lattice) {
    return { ...state, base: { ...state.base, lattice: { ...state.base.lattice, ...normalizePatch } } };
  }

  if (layer.kind !== "cover" && layer.kind !== "coverLattice") {
    return state;
  }

  return {
    ...state,
    covers: state.covers.map((cover) => {
      if (cover.id !== layer.id) {
        return cover;
      }

      if (layer.kind === "cover") {
        return { ...cover, ...normalizePatch };
      }

      if (layer.kind === "coverLattice" && cover.lattice) {
        return { ...cover, lattice: { ...cover.lattice, ...normalizePatch } };
      }

      return cover;
    }),
  };
}

function updateLatticeForLayer(state: LogoState, layer: EditableLayer, patch: Partial<LatticeLayer>): LogoState {
  if (layer.kind === "baseLattice" && state.base.lattice) {
    return { ...state, base: { ...state.base, lattice: { ...state.base.lattice, ...patch } } };
  }

  if (layer.kind !== "coverLattice") {
    return state;
  }

  return {
    ...state,
    covers: state.covers.map((cover) =>
      cover.id === layer.id && cover.lattice ? { ...cover, lattice: { ...cover.lattice, ...patch } } : cover,
    ),
  };
}

function addOrRemoveCoverLattice(state: LogoState, id: string, enabled: boolean): LogoState {
  if (!enabled) {
    return {
      ...state,
      covers: state.covers.map((cover) => (cover.id === id ? { ...cover, lattice: undefined } : cover)),
      stack: state.stack.filter((item) => !(item.kind === "coverLattice" && item.id === id)),
    };
  }

  const cover = findCover(state, { kind: "cover", id });

  if (!cover || cover.lattice) {
    return state;
  }

  const insertIndex = Math.max(0, state.stack.findIndex((item) => item.kind === "cover" && item.id === id) + 1);
  const nextStack = [...state.stack];
  nextStack.splice(insertIndex, 0, { kind: "coverLattice", id });

  return {
    ...state,
    covers: state.covers.map((candidate) =>
      candidate.id === id
        ? {
            ...candidate,
            selected: true,
            lattice: createLatticeFromSource(candidate),
          }
        : candidate,
    ),
    stack: nextStack,
  };
}

function moveLayerInStack(state: LogoState, layer: EditableLayer, direction: -1 | 1): LogoState {
  const stackItem = editableToStackItem(layer);

  if (!stackItem) {
    return state;
  }

  const index = state.stack.findIndex((item) => item.kind === stackItem.kind && item.id === stackItem.id);
  const nextIndex = index + direction;

  if (index < 0 || nextIndex < 0 || nextIndex >= state.stack.length) {
    return state;
  }

  const stack = [...state.stack];
  [stack[index], stack[nextIndex]] = [stack[nextIndex], stack[index]];
  return { ...state, stack };
}

function canMoveLayer(state: LogoState, layer: EditableLayer, direction: -1 | 1): boolean {
  const stackItem = editableToStackItem(layer);

  if (!stackItem) {
    return false;
  }

  const index = state.stack.findIndex((item) => item.kind === stackItem.kind && item.id === stackItem.id);
  const nextIndex = index + direction;
  return index >= 0 && nextIndex >= 0 && nextIndex < state.stack.length;
}

function editableToStackItem(layer: EditableLayer): StackItem | null {
  if (layer.kind === "cover") {
    return { kind: "cover", id: layer.id };
  }

  if (layer.kind === "coverLattice") {
    return { kind: "coverLattice", id: layer.id };
  }

  return null;
}

function mapSelectedRotations(state: LogoState, deltaRotation: Matrix3): LogoState {
  return {
    ...state,
    base: {
      ...state.base,
      rotation: state.base.selected
        ? normalizeRotation(multiplyMatrices(deltaRotation, state.base.rotation))
        : state.base.rotation,
      lattice:
        state.base.lattice && state.base.lattice.selected
          ? {
              ...state.base.lattice,
              rotation: normalizeRotation(multiplyMatrices(deltaRotation, state.base.lattice.rotation)),
            }
          : state.base.lattice,
    },
    covers: state.covers.map((cover) => ({
      ...cover,
      rotation: cover.selected ? normalizeRotation(multiplyMatrices(deltaRotation, cover.rotation)) : cover.rotation,
      lattice:
        cover.lattice && cover.lattice.selected
          ? { ...cover.lattice, rotation: normalizeRotation(multiplyMatrices(deltaRotation, cover.lattice.rotation)) }
          : cover.lattice,
    })),
  };
}

function rotatableLayers(state: LogoState): RotatableLayerRef[] {
  const layers: RotatableLayerRef[] = [{ kind: "base", key: "base", rotation: state.base.rotation }];

  if (state.base.lattice) {
    layers.push({ kind: "baseLattice", key: "base-lattice", rotation: state.base.lattice.rotation });
  }

  for (const item of state.stack) {
    const cover = findCover(state, item);

    if (!cover) {
      continue;
    }

    if (item.kind === "cover") {
      layers.push({ kind: "cover", key: `cover-${cover.id}`, id: cover.id, rotation: cover.rotation });
    } else if (cover.lattice) {
      layers.push({ kind: "coverLattice", key: `cover-lattice-${cover.id}`, id: cover.id, rotation: cover.lattice.rotation });
    }
  }

  return layers;
}

function isLayerSelected(state: LogoState, layer: RotatableLayerRef): boolean {
  if (layer.kind === "base") {
    return state.base.selected;
  }

  if (layer.kind === "baseLattice") {
    return state.base.lattice?.selected === true;
  }

  const cover = state.covers.find((candidate) => candidate.id === layer.id);

  if (!cover) {
    return false;
  }

  return layer.kind === "cover" ? cover.selected : cover.lattice?.selected === true;
}

function editablePaint(state: LogoState, layer: EditableLayer): PaintStyle | null {
  if (layer.kind === "background") {
    return state.background;
  }

  if (layer.kind === "base") {
    return state.base;
  }

  if (layer.kind === "baseLattice") {
    return state.base.lattice ?? null;
  }

  const cover = state.covers.find((candidate) => candidate.id === layer.id);

  if (!cover) {
    return null;
  }

  return layer.kind === "cover" ? cover : cover.lattice ?? null;
}

function editableLattice(state: LogoState, layer: EditableLayer): LatticeLayer | null {
  if (layer.kind === "baseLattice") {
    return state.base.lattice ?? null;
  }

  if (layer.kind === "coverLattice") {
    return state.covers.find((cover) => cover.id === layer.id)?.lattice ?? null;
  }

  return null;
}

function sourceHasLattice(state: LogoState, layer: EditableLayer): boolean {
  if (layer.kind === "base") {
    return Boolean(state.base.lattice);
  }

  if (layer.kind === "cover") {
    return Boolean(state.covers.find((cover) => cover.id === layer.id)?.lattice);
  }

  return false;
}

function findCover(state: LogoState, item: StackItem): CoverLayer | undefined {
  return state.covers.find((cover) => cover.id === item.id);
}

function parseLatticeResolution(value: string): LatticeResolution {
  const parsed = Number(value);
  return LATTICE_OPTIONS.includes(parsed as (typeof LATTICE_OPTIONS)[number])
    ? (parsed as LatticeResolution)
    : 320;
}

function previewStateForCover(state: LogoState, cover: CoverLayer): LogoState {
  return {
    background: { colorMode: "normal", color: "#ffffff", alpha: 0 },
    base: invisibleBase(),
    covers: [{ ...cover, selected: false, lattice: undefined }],
    stack: [{ kind: "cover", id: cover.id }],
  };
}

function previewStateForBaseLattice(state: LogoState): LogoState {
  return {
    ...state,
    background: { colorMode: "normal", color: "#ffffff", alpha: 0 },
    base: {
      ...invisibleBase(),
      lattice: state.base.lattice ? { ...state.base.lattice, selected: false } : undefined,
    },
    covers: [],
    stack: [],
  };
}

function previewStateForCoverLattice(state: LogoState, cover: CoverLayer): LogoState {
  return {
    background: { colorMode: "normal", color: "#ffffff", alpha: 0 },
    base: invisibleBase(),
    covers: [{ ...cover, selected: false }],
    stack: cover.lattice ? [{ kind: "coverLattice", id: cover.id }] : [],
  };
}

function invisibleBase(): LogoState["base"] {
  return {
    colorMode: "normal",
    color: "#ffffff",
    alpha: 0,
    rotation: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    selected: false,
  };
}

function twistAngle(points: PointerPoint[]): number {
  const [first, second] = points;
  return Math.atan2(second.y - first.y, second.x - first.x);
}

function dragToScreenRotation(deltaX: number, deltaY: number): Matrix3 {
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
