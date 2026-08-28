import { Check, Save, Trash2, X } from "lucide-react";
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
import {
  BORDER_WIDTH_MAX,
  DASH_LENGTH_MAX,
  BORDER_WIDTH_MIN,
  createBorder,
  createLatticeFromSource,
  loadLogoState,
  saveLogoState,
} from "./storage";
import { exportLogoPng, renderLogoToCanvas } from "./logoRenderer";
import { exportLogoSvg } from "./svgExport";
import { MAX_FREQUENCY, MIN_FREQUENCY, clampFrequency } from "./icosphere";
import {
  eulerToMatrix,
  identityRotation,
  matrixToEuler,
  multiplyMatrices,
  normalizeRotation,
  screenAxisRotation,
  type EulerAngles,
  type Matrix3,
} from "./rotation";
import type {
  BackEdgeMode,
  BorderLayer,
  ColorMode,
  EditableLayer,
  LatticeLayer,
  LogoState,
  PaintStyle,
} from "./types";

const DRAG_DEGREES_PER_PIXEL = 0.45;
const EULER_FIELDS = [
  { key: "roll", label: "Roll" },
  { key: "pitch", label: "Pitch" },
  { key: "yaw", label: "Yaw" },
] as const;
const BLANK_EULER_DRAFTS = { roll: "", pitch: "", yaw: "" };
const EULER_MIN = 0;
const EULER_MAX = 360;
const EULER_STEP = 0.1;
const BACK_EDGE_MODES: { value: BackEdgeMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "mask", label: "Lattice" },
  { value: "both", label: "Both" },
  { value: "through", label: "Through" },
];
const LINE_WIDTH_MIN = 1;
const LINE_WIDTH_MAX = 12;
const DEFAULT_PREVIEW_SIZE = 52;

type ExportFormat = "png" | "svg";

const EXPORT_FORMATS: ExportFormat[] = ["png", "svg"];

type EulerField = (typeof EULER_FIELDS)[number]["key"];

type LayerSwatchProps = {
  kind: "background" | "base" | "cover" | "lattice" | "border";
  paint?: PaintStyle;
  previewState?: LogoState;
  onOpen: () => void;
  ariaLabel: string;
  layerKey: string;
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

// A rotation matrix has many valid Euler decompositions. While the user works a
// slider we keep showing the triple they are actually driving, so the other two
// readouts do not jump to an equivalent-but-different decomposition mid-drag.
type EulerDisplayOverride = {
  rotation: Matrix3;
  values: EulerAngles;
};

export default function App() {
  const [logoState, setLogoState] = useState<LogoState>(() => loadLogoState());
  const [editingLayer, setEditingLayer] = useState<EditableLayer | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [filename, setFilename] = useState("logo.png");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [canvasSize, setCanvasSize] = useState(0);
  const [activeEulerField, setActiveEulerField] = useState<EulerField | null>(null);
  const [eulerDrafts, setEulerDrafts] = useState<Record<EulerField, string>>(BLANK_EULER_DRAFTS);
  const [eulerDisplayOverride, setEulerDisplayOverride] = useState<EulerDisplayOverride | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoShellRef = useRef<HTMLDivElement | null>(null);
  const activePointersRef = useRef<Map<number, PointerPoint>>(new Map());
  const lastTwistAngleRef = useRef<number | null>(null);
  const saveInputRef = useRef<HTMLInputElement | null>(null);
  const editingPaint = editingLayer ? editablePaint(logoState, editingLayer) : null;
  const editingLattice = editingLayer ? editableLattice(logoState, editingLayer) : null;
  const editingBorder = editingLayer?.kind === "border" ? logoState.border ?? null : null;
  const referenceEuler = useMemo(() => {
    if (eulerDisplayOverride && matricesAreClose(eulerDisplayOverride.rotation, logoState.rotation)) {
      return eulerDisplayOverride.values;
    }

    return matrixToEuler(logoState.rotation);
  }, [eulerDisplayOverride, logoState.rotation]);
  const eulerDisplayValues = useMemo(
    () => ({
      roll: formatEulerAngle(referenceEuler.roll),
      pitch: formatEulerAngle(referenceEuler.pitch),
      yaw: formatEulerAngle(referenceEuler.yaw),
    }),
    [referenceEuler],
  );

  useEffect(() => {
    saveLogoState(logoState);
  }, [logoState]);

  useEffect(() => {
    if (!activeEulerField) {
      setEulerDrafts(eulerDisplayValues);
    }
  }, [activeEulerField, eulerDisplayValues]);

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

  function updateEditingColor(color: string) {
    updateEditablePaint({ color, colorMode: "normal" });
  }

  function updateEditingAlpha(alpha: number) {
    updateEditablePaint({ alpha: clamp(alpha, 0, 1) });
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

  function setLatticeEnabled(target: "base" | "cover", enabled: boolean) {
    setLogoState((current) => {
      const source = target === "base" ? current.base : current.cover;

      if (!enabled) {
        return { ...current, [target]: { ...source, lattice: undefined } };
      }

      if (source.lattice) {
        return current;
      }

      return { ...current, [target]: { ...source, lattice: createLatticeFromSource(source) } };
    });
  }

  function updateEditingLatticeEnabled(enabled: boolean) {
    if (editingLayer?.kind !== "base" && editingLayer?.kind !== "cover") {
      return;
    }

    setLatticeEnabled(editingLayer.kind, enabled);
  }

  function setBorderEnabled(enabled: boolean) {
    setLogoState((current) => ({
      ...current,
      border: enabled ? current.border ?? createBorder() : undefined,
    }));
  }

  function updateEditingBorder(patch: Partial<BorderLayer>) {
    setLogoState((current) => (current.border ? { ...current, border: { ...current.border, ...patch } } : current));
  }

  function deleteEditingBorder() {
    setLogoState((current) => ({ ...current, border: undefined }));
    setEditingLayer(null);
  }

  function updateEditingLatticeDensity(frequency: number) {
    updateEditableLattice({ frequency: clampFrequency(frequency) });
  }

  function updateEditingLineWidth(lineWidth: number) {
    updateEditableLattice({ lineWidth: clamp(lineWidth, LINE_WIDTH_MIN, LINE_WIDTH_MAX) });
  }

  function updateEditableLattice(patch: Partial<LatticeLayer>) {
    if (!editingLayer) {
      return;
    }

    setLogoState((current) => updateLatticeForLayer(current, editingLayer, patch));
  }

  function deleteEditingLattice() {
    if (!editingLayer || (editingLayer.kind !== "baseLattice" && editingLayer.kind !== "coverLattice")) {
      return;
    }

    const target = editingLayer.kind === "baseLattice" ? "base" : "cover";

    setLogoState((current) => ({ ...current, [target]: { ...current[target], lattice: undefined } }));
    setEditingLayer(null);
  }

  function rotateLogo(deltaRotation: Matrix3) {
    setEulerDisplayOverride(null);
    setLogoState((current) => ({
      ...current,
      rotation: normalizeRotation(multiplyMatrices(deltaRotation, current.rotation)),
    }));
  }

  function setEulerValue(field: EulerField, value: number) {
    const nextEuler = { ...referenceEuler, [field]: clamp(value, EULER_MIN, EULER_MAX) };
    const rotation = normalizeRotation(eulerToMatrix(nextEuler.roll, nextEuler.pitch, nextEuler.yaw));

    setLogoState((current) => ({ ...current, rotation }));
    setEulerDisplayOverride({ rotation, values: nextEuler });
  }

  function handleEulerSlider(field: EulerField, value: number) {
    if (!Number.isFinite(value)) {
      return;
    }

    setEulerValue(field, value);
  }

  function commitEulerField(field: EulerField, rawValue: string) {
    const trimmedValue = rawValue.trim();
    const parsed = Number(trimmedValue);

    if (trimmedValue === "" || !Number.isFinite(parsed)) {
      setActiveEulerField(null);
      setEulerDrafts(eulerDisplayValues);
      return;
    }

    setEulerValue(field, parsed);
    setActiveEulerField(null);
  }

  function handleEulerFocus(field: EulerField) {
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

  function resetRotation() {
    setEulerDisplayOverride(null);
    setLogoState((current) => ({ ...current, rotation: identityRotation() }));
  }

  function handleLogoPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
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

    if (!pointer) {
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
      rotateLogo(twistToScreenRotation(previousAngle, nextAngle));
      return;
    }

    const deltaX = event.clientX - pointer.x;
    const deltaY = event.clientY - pointer.y;

    if (event.shiftKey) {
      rotateLogo(shiftDragToScreenRotation(event.currentTarget, pointer, { x: event.clientX, y: event.clientY }));
    } else {
      rotateLogo(dragToScreenRotation(deltaX, deltaY));
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
    setFilename(`logo.${exportFormat}`);
    setSaveModalOpen(true);
  }

  function changeExportFormat(format: ExportFormat) {
    setExportFormat(format);
    setFilename((current) => withExtension(current, format));
  }

  async function saveLogo() {
    const blob =
      exportFormat === "svg"
        ? new Blob([exportLogoSvg(logoState)], { type: "image/svg+xml" })
        : await exportLogoPng(logoState);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = withExtension(filename, exportFormat);
    link.click();
    URL.revokeObjectURL(url);
    setSaveModalOpen(false);
  }

  return (
    <main className={`app-shell${editingLayer || saveModalOpen ? " editing" : ""}`}>
      <header className="top-panel">
        <div className="layer-row" aria-label="Layers">
          <LayerSwatch
            kind="background"
            paint={logoState.background}
            onOpen={() => setEditingLayer({ kind: "background" })}
            ariaLabel="Background"
            layerKey="background"
          />
          <LayerSwatch
            kind="base"
            paint={logoState.base}
            onOpen={() => setEditingLayer({ kind: "base" })}
            ariaLabel="Base sphere"
            layerKey="base"
          />
          {logoState.base.lattice && (
            <LayerSwatch
              kind="lattice"
              paint={logoState.base.lattice}
              previewState={previewStateForBaseLattice(logoState)}
              onOpen={() => setEditingLayer({ kind: "baseLattice" })}
              ariaLabel="Base lattice"
              layerKey="base-lattice"
            />
          )}
          <LayerSwatch
            kind="cover"
            paint={logoState.cover}
            previewState={previewStateForCover(logoState)}
            onOpen={() => setEditingLayer({ kind: "cover" })}
            ariaLabel="Cover"
            layerKey="cover"
          />
          {logoState.cover.lattice && (
            <LayerSwatch
              kind="lattice"
              paint={logoState.cover.lattice}
              previewState={previewStateForCoverLattice(logoState)}
              onOpen={() => setEditingLayer({ kind: "coverLattice" })}
              ariaLabel="Cover lattice"
              layerKey="cover-lattice"
            />
          )}
          {logoState.border && (
            <LayerSwatch
              kind="border"
              paint={logoState.border}
              previewState={previewStateForBorder(logoState)}
              onOpen={() => setEditingLayer({ kind: "border" })}
              ariaLabel="Border"
              layerKey="border"
            />
          )}
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
              <div key={key} className="euler-field">
                <span className="euler-label">{label}</span>
                <input
                  className="euler-slider"
                  type="range"
                  min={EULER_MIN}
                  max={EULER_MAX}
                  step={EULER_STEP}
                  value={referenceEuler[key]}
                  onChange={(event) => handleEulerSlider(key, Number(event.target.value))}
                  onDoubleClick={() => setEulerValue(key, 0)}
                  aria-label={`${label} slider`}
                />
                <input
                  className="euler-value"
                  type="text"
                  inputMode="decimal"
                  value={activeEulerField === key ? eulerDrafts[key] : eulerDisplayValues[key]}
                  onFocus={() => handleEulerFocus(key)}
                  onChange={(event) => handleEulerChange(key, event.target.value)}
                  onBlur={() => handleEulerBlur(key)}
                  onKeyDown={handleEulerKeyDown}
                  aria-label={label}
                />
              </div>
            ))}
          </div>
        )}

        <div className="bottom-actions">
          {!editingLayer && !saveModalOpen && (
            <button className="reset-button" type="button" onClick={resetRotation} aria-label="Reset rotation">
              Reset
            </button>
          )}
          <button className="icon-button save-button" type="button" onClick={openSaveModal} aria-label="Save logo">
            <Save aria-hidden="true" size={24} strokeWidth={2.35} />
          </button>
        </div>
      </footer>

      {editingLayer && editingPaint && (
        <div className="modal-layer">
          <div
            className={`tool-modal color-modal${editingLattice ? " lattice-modal" : ""}`}
            role="dialog"
            aria-label={editingLattice ? "Lattice color" : "Layer color"}
          >
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

            {editingLayer.kind === "base" && (
              <div className="inline-control-group">
                <span className="modal-label">Border</span>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={Boolean(logoState.border)}
                    onChange={(event) => setBorderEnabled(event.target.checked)}
                    aria-label="Border"
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
            )}

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

            {editingBorder && (
              <>
                <div className="control-group">
                  <span className="modal-label">Width</span>
                  <input
                    className="line-width-input"
                    type="range"
                    min={BORDER_WIDTH_MIN}
                    max={BORDER_WIDTH_MAX}
                    step="0.1"
                    value={editingBorder.width}
                    onChange={(event) =>
                      updateEditingBorder({ width: clamp(Number(event.target.value), BORDER_WIDTH_MIN, BORDER_WIDTH_MAX) })
                    }
                    aria-label="Border width"
                  />
                </div>

                <button className="trash-button icon-button" type="button" onClick={deleteEditingBorder} aria-label="Delete border">
                  <Trash2 aria-hidden="true" size={23} strokeWidth={2.4} />
                </button>
              </>
            )}

            {editingLattice && (
              <>
                <div className="control-group">
                  <span className="modal-label">Density</span>
                  <input
                    className="line-width-input"
                    type="range"
                    min={MIN_FREQUENCY}
                    max={MAX_FREQUENCY}
                    step={1}
                    value={editingLattice.frequency}
                    onChange={(event) => updateEditingLatticeDensity(Number(event.target.value))}
                    aria-label="Density"
                  />
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
                  <span className="modal-label">Outline</span>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={editingLattice.outline}
                      onChange={(event) => updateEditableLattice({ outline: event.target.checked })}
                      aria-label="Outline"
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                <div className="control-group">
                  <span className="modal-label">Outline width</span>
                  <input
                    className="line-width-input"
                    type="range"
                    min={BORDER_WIDTH_MIN}
                    max={BORDER_WIDTH_MAX}
                    step="0.1"
                    value={editingLattice.outlineWidth}
                    disabled={!editingLattice.outline}
                    onChange={(event) =>
                      updateEditableLattice({
                        outlineWidth: clamp(Number(event.target.value), BORDER_WIDTH_MIN, BORDER_WIDTH_MAX),
                      })
                    }
                    aria-label="Outline width"
                  />
                </div>
                <div className="control-group">
                  <span className="modal-label">Spin</span>
                  <div className="offset-grid">
                    {EULER_FIELDS.map(({ key, label }) => (
                      <label key={key} className="offset-field">
                        <span>{label}</span>
                        <input
                          type="range"
                          min={EULER_MIN}
                          max={EULER_MAX}
                          step={1}
                          value={editingLattice.offset[key]}
                          onChange={(event) =>
                            updateEditableLattice({
                              offset: { ...editingLattice.offset, [key]: clamp(Number(event.target.value), EULER_MIN, EULER_MAX) },
                            })
                          }
                          aria-label={`Spin ${label.toLowerCase()}`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="control-group">
                  <span className="modal-label">Dashes</span>
                  <input
                    className="line-width-input"
                    type="range"
                    min={0}
                    max={DASH_LENGTH_MAX}
                    step="0.5"
                    value={editingLattice.dashLength}
                    onChange={(event) =>
                      updateEditableLattice({ dashLength: clamp(Number(event.target.value), 0, DASH_LENGTH_MAX) })
                    }
                    aria-label="Dashes"
                  />
                </div>
                <div className="control-group">
                  <span className="modal-label">Back edges</span>
                  <select
                    className="lattice-select"
                    value={editingLattice.backEdges}
                    onChange={(event) => updateEditableLattice({ backEdges: event.target.value as BackEdgeMode })}
                    aria-label="Back edges"
                  >
                    {BACK_EDGE_MODES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="inline-control-group">
                  <span className="modal-label">Cut fill</span>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      checked={editingLattice.cutFill}
                      onChange={(event) => updateEditableLattice({ cutFill: event.target.checked })}
                      aria-label="Cut fill"
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                <button className="trash-button icon-button" type="button" onClick={deleteEditingLattice} aria-label="Delete lattice">
                  <Trash2 aria-hidden="true" size={23} strokeWidth={2.4} />
                </button>
              </>
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
            <select
              className="lattice-select format-select"
              value={exportFormat}
              onChange={(event) => changeExportFormat(event.target.value as ExportFormat)}
              aria-label="Format"
            >
              {EXPORT_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format.toUpperCase()}
                </option>
              ))}
            </select>
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
    renderLogoToCanvas(
      canvas,
      {
        background: { colorMode: "normal", color: "#ffffff", alpha: 0 },
        base: { colorMode: "normal", color: "#ffffff", alpha: 0, lattice },
        cover: { colorMode: "normal", color: "#000000", alpha: 0 },
        rotation: identityRotation(),
      },
      { transparent: true, padding: 0.08 },
    );
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

function LayerSwatch({ kind, paint, previewState, onOpen, ariaLabel, layerKey }: LayerSwatchProps) {
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

  return (
    <button
      className={`layer-swatch ${kind}-swatch${paint?.colorMode === "knockout" ? " knockout" : ""}`}
      type="button"
      aria-label={ariaLabel}
      data-layer-key={layerKey}
      data-layer-kind={kind}
      style={{ "--swatch-color": paint?.color ?? "#ffffff", "--swatch-alpha": paint?.alpha ?? 1 } as CSSProperties}
      onClick={onOpen}
    >
      {kind === "background" || kind === "base" ? <span aria-hidden="true" /> : <canvas ref={previewCanvasRef} aria-hidden="true" />}
    </button>
  );
}

function updatePaintForLayer(state: LogoState, layer: EditableLayer, patch: Partial<PaintStyle>): LogoState {
  const normalizedPatch = patch.colorMode === "knockout" ? { ...patch, alpha: 1 } : patch;

  switch (layer.kind) {
    case "background":
      // The background is the ground everything sits on, so it never knocks out.
      return { ...state, background: { ...state.background, ...normalizedPatch, colorMode: "normal" } };
    case "base":
      return { ...state, base: { ...state.base, ...normalizedPatch } };
    case "cover":
      return { ...state, cover: { ...state.cover, ...normalizedPatch } };
    case "baseLattice":
      return updateLatticeForLayer(state, layer, normalizedPatch);
    case "coverLattice":
      return updateLatticeForLayer(state, layer, normalizedPatch);
    case "border":
      return state.border ? { ...state, border: { ...state.border, ...normalizedPatch } } : state;
  }
}

function updateLatticeForLayer(state: LogoState, layer: EditableLayer, patch: Partial<LatticeLayer>): LogoState {
  if (layer.kind === "baseLattice" && state.base.lattice) {
    return { ...state, base: { ...state.base, lattice: { ...state.base.lattice, ...patch } } };
  }

  if (layer.kind === "coverLattice" && state.cover.lattice) {
    return { ...state, cover: { ...state.cover, lattice: { ...state.cover.lattice, ...patch } } };
  }

  return state;
}

function editablePaint(state: LogoState, layer: EditableLayer): PaintStyle | null {
  switch (layer.kind) {
    case "background":
      return state.background;
    case "base":
      return state.base;
    case "cover":
      return state.cover;
    case "baseLattice":
      return state.base.lattice ?? null;
    case "coverLattice":
      return state.cover.lattice ?? null;
    case "border":
      return state.border ?? null;
  }
}

function editableLattice(state: LogoState, layer: EditableLayer): LatticeLayer | null {
  if (layer.kind === "baseLattice") {
    return state.base.lattice ?? null;
  }

  if (layer.kind === "coverLattice") {
    return state.cover.lattice ?? null;
  }

  return null;
}

function sourceHasLattice(state: LogoState, layer: EditableLayer): boolean {
  if (layer.kind === "base") {
    return Boolean(state.base.lattice);
  }

  if (layer.kind === "cover") {
    return Boolean(state.cover.lattice);
  }

  return false;
}


const INVISIBLE_PAINT: PaintStyle = { colorMode: "normal", color: "#ffffff", alpha: 0 };

function previewStateForCover(state: LogoState): LogoState {
  return {
    background: INVISIBLE_PAINT,
    base: INVISIBLE_PAINT,
    cover: { ...state.cover, lattice: undefined },
    rotation: state.rotation,
  };
}

function previewStateForBaseLattice(state: LogoState): LogoState {
  return {
    background: INVISIBLE_PAINT,
    base: { ...INVISIBLE_PAINT, lattice: state.base.lattice },
    cover: INVISIBLE_PAINT,
    rotation: state.rotation,
  };
}

function previewStateForBorder(state: LogoState): LogoState {
  return {
    background: INVISIBLE_PAINT,
    base: INVISIBLE_PAINT,
    cover: INVISIBLE_PAINT,
    border: state.border,
    rotation: state.rotation,
  };
}

function previewStateForCoverLattice(state: LogoState): LogoState {
  return {
    background: INVISIBLE_PAINT,
    base: INVISIBLE_PAINT,
    cover: { ...INVISIBLE_PAINT, lattice: state.cover.lattice },
    rotation: state.rotation,
  };
}

function twistAngle(points: PointerPoint[]): number {
  return Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
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
  previous: Pick<PointerPoint, "x" | "y">,
  next: Pick<PointerPoint, "x" | "y">,
): Matrix3 {
  const previousAngle = pointerAngleAroundElement(element, previous);
  const nextAngle = pointerAngleAroundElement(element, next);
  return screenAxisRotation({ zDegrees: radiansToDegrees(shortestAngleDelta(previousAngle, nextAngle)) });
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
    row.every((entry, columnIndex) => Math.abs(entry - second[rowIndex][columnIndex]) < 1e-6),
  );
}

function filenameStemEnd(value: string): number {
  const lower = value.toLowerCase();
  return lower.endsWith(".png") || lower.endsWith(".svg") ? value.length - 4 : value.length;
}

function withExtension(value: string, format: ExportFormat): string {
  const trimmed = value.trim() || "logo";
  const stem = trimmed.slice(0, filenameStemEnd(trimmed)) || "logo";
  return `${stem}.${format}`;
}
