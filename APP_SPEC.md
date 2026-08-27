# Logo Builder PWA Specification

This document is the source of truth for the app. Any future change to the product, interaction model, rendering behavior, export behavior, or verification expectations should update this document in the same change.

## Purpose

Build an extremely simple installable PWA for creating a logo: a centered 2D image of a sphere with one or more realistic baseball-cover halves layered over it.

The app is a visual instrument with one compact numeric rotation editor. Visible main-screen text is limited to the `Roll`, `Pitch`, and `Yaw` field labels and values.

## Product Shape

- The app is a PWA modeled after the structure of `../qwixx`.
- The implementation target is React, TypeScript, Vite, and Canvas 2D.
- The app should work well on touch devices and desktop browsers.
- The app background is a subtle checkerboard transparency-preview surface.
- The logo includes an editable square background layer.
- The final exported logo uses only the editable background layer as its background; there is no forced white export background underneath it.
- The checkerboard is an editor preview aid only and is never included in exported PNGs.
- The app persists its state locally and restores it on reload.

## Main Screen

The main screen has only these visible elements:

- A full-width opaque white top panel containing the layer controls.
- A plus icon for adding a cover layer.
- The logo preview centered in the middle work area, with the editable square background behind the centered circular logo.
- A full-width opaque white bottom panel containing the compact `Roll`, `Pitch`, and `Yaw` fields left-aligned and the save icon right-aligned.

No other visible text is allowed on the main screen.

Accessible names may be present through `aria-label` or equivalent hidden metadata. These labels must not be visually rendered.

## Layers

The app starts with:

- One background layer.
- One base sphere layer.
- One cover layer.

The background layer:

- Is always the first item in the top layer row.
- Is shown as a square swatch.
- Is a square export backdrop behind the circular logo.
- Is extended visually through the entire middle work area between the top and bottom panels in the editor.
- Does not change the logo preview canvas size.
- Does not change the saved PNG size or export buffer.
- Defaults to white with alpha `1`.
- Defaults to normal color mode, not transparent/knockout color mode.
- Has editable color, transparent/knockout color mode, and alpha.
- Is not rotatable.
- Is never visually shown as selected.
- Cannot be deleted.
- Cannot move.
- Is edited by long-pressing its top-row square.
- Is the special select-all/select-none control for rotatable layers.

The base sphere:

- Is always the second item in the top layer row, immediately after the background.
- Is a complete sphere, not a partial cover.
- Defaults to white with alpha `1`.
- Defaults to normal color mode, not transparent/knockout color mode.
- Is flat, with no shading.
- Has no outline or visible boundary beyond its fill.
- Defaults to lattice disabled.
- Can toggle a paired base lattice layer on or off.
- Is selectable and rotatable.
- Is visually shown as selected when selected.
- Cannot be deleted.
- Cannot move.
- Can be edited by long-pressing its top-row circle.

Cover layers:

- Represent one half of a realistic baseball cover.
- Default to black with alpha `1`.
- Default to normal color mode, not transparent/knockout color mode.
- Are independently ordered in the layer stack above the locked background/base area.
- Are always drawn as filled shapes, with no seam lines, strokes, outlines, or edge marks.
- Default to lattice disabled.
- Can toggle a paired cover lattice layer on or off.
- Can be added with the plus icon.
- A newly added cover starts selected.
- Can be edited by long-pressing its top-row circle.
- Can be deleted from the edit modal.

Lattice layers:

- Are created by toggling lattice on from a base sphere or cover source layer.
- Are deleted by toggling lattice off from the source layer or pressing the trash icon in the lattice modal.
- Are paired to their source layer for mask geometry only.
- Have their own color mode, color, alpha, resolution, line width, intersection-dot setting, dot size, rotation, selection state, and stack position.
- Do not inherit color mode, color, alpha, line width, or resolution from the source after creation.
- Default on creation to the source layer's current color, alpha, and color mode, resolution `320`, line width `3`, intersection dots off, dot size `4`, identity rotation, and selected.
- Toggling lattice off deletes that lattice layer's editable state; toggling lattice on later creates a fresh lattice layer that copies the source's current color, alpha, and color mode and resets all other lattice settings to their defaults.
- Use `20`, `80`, `320`, `1280`, or `5120` triangles over the entire sphere.
- Are drawn over their source by default, but cover lattice layers can later be moved independently in the stack.
- The base lattice layer, if present, is selectable and rotatable but locked immediately above the base sphere and cannot move.
- Deleting a cover source layer also deletes its paired lattice layer wherever that lattice layer appears in the stack.

Layer stack:

- The background layer is permanently deepest.
- The base sphere source is permanently immediately above the background.
- The base lattice layer, if present, is permanently immediately above the base sphere.
- Nothing can move below the background, base sphere, or base lattice locked area.
- Cover source layers and cover lattice layers are independently ordered above the locked background/base area.
- New cover source layers are added at the surface.
- A new cover lattice layer is initially inserted immediately outside/right of its source cover.
- Moving a cover source layer does not move its paired lattice layer.
- Moving a cover lattice layer does not move its paired source cover.

## Layer Row

The layer row:

- Appears inside a full-width opaque white panel touching the top of the screen.
- Shows a square swatch for the background layer at far left.
- Shows a circular swatch for the base sphere.
- Shows each cover layer as the actual visible front-view shape of that cover.
- Shows each lattice layer as a clipped preview of its spherical triangle lattice inside the source layer's current mask.
- Shows the base sphere immediately after the background.
- Shows the base lattice immediately after the base sphere if the base lattice exists.
- Shows all movable cover source layers and cover lattice layers in their actual stack order from deepest/inside/left to surface-most/outside/right.
- Shows a plus icon at far right.
- Uses the background layer's current color mode, color, and alpha in its square row preview.
- Uses each source layer's current color mode, color, and alpha in its row preview.
- Uses each lattice layer's own color mode, color, alpha, resolution, line width, source mask, and rotation in its row preview.
- Uses each cover source layer's current rotation in its row preview.
- Uses an opaque white panel background, while the interior of each background/base/cover/lattice swatch remains transparent to the checkerboard transparency-preview surface.
- Transparent or white layers remain discoverable through the control border, shadow, selected cover ring, and knockout treatment.
- Shows transparent/knockout color layers with a discoverable checkerboard or diagonal-slash treatment in the swatch.
- Shows selected base sphere, cover, and lattice layers with a visual ring or equivalent icon-free treatment.
- Does not show the background layer as selected.

## Color And Alpha

Every drawable layer has a color mode:

- Normal color mode draws the layer with its selected color and alpha.
- Transparent/knockout color mode uses a special transparent color swatch that is separate from alpha.

Normal alpha behavior:

- Alpha is a continuous value from `0` to `1`.
- Lower alpha makes the layer partially transparent, allowing already-rendered lower layers to show through.
- Alpha `0` makes that layer contribute no visible pixels, but it does not erase lower layers.

Transparent/knockout color behavior:

- The alpha value is locked to `1`.
- The alpha slider is disabled while transparent/knockout color mode is active.
- The layer erases only pixels from layers below it in the stack.
- Layers above it still draw normally after it.
- The knockout affects only the layer's visible drawn geometry.
- For a base sphere or solid cover source, the filled visible shape punches through lower layers.
- For a lattice layer, only visible lattice lines, cookie-cutter outline, and enabled intersection dots punch through lower layers; transparent lattice gaps do not punch through.
- For the background layer, the square background geometry contributes no color and leaves transparent pixels because there is no implicit background beneath it.

Switching out of transparent/knockout color mode:

- Keeps alpha at `1`.
- Re-enables the alpha slider.
- Uses the current or newly selected normal color.

## Selection

Multiple rotatable layers may be selected at once. Rotatable layers include the base sphere source, cover source layers, and lattice layers. The background layer is never selected.

Clicking or tapping the background swatch:

- Selects all rotatable layers if any rotatable layer is currently unselected.
- Clears all rotatable layer selections if all rotatable layers are already selected.
- Does not visually select the background itself.

Clicking or tapping the base sphere swatch:

- Toggles only the base sphere's selected state.
- Does not affect any other layer.

Clicking or tapping a cover swatch:

- Toggles only that cover's selected state.
- Does not affect any other layer.

Clicking or tapping a lattice layer swatch:

- Toggles only that lattice layer's selected state.
- Does not affect any other layer.

Dragging the logo:

- Rotates selected rotatable layers only.
- Does nothing when no rotatable layers are selected.
- Does not rotate the background.

When a source layer's lattice toggle changes from off to on:

- The lattice layer is created.
- For the base sphere source, the base sphere and new base lattice layer both become selected.
- For a cover source, the source cover and new cover lattice layer both become selected.
- Other existing selections are preserved.

## Long-Press Editing

Long-pressing a swatch opens a modal for that layer.

The modal must not open from a normal quick click.

Pointer movement beyond the drag threshold cancels long-press opening.

The base sphere edit modal contains:

- Disabled left and right arrow buttons because the base sphere is position-locked.
- The visible label `Color` above the color controls.
- A color selector with normal colors and the transparent/knockout color.
- The visible label `Alpha` above the alpha slider.
- An alpha slider from `0` to `1`.
- The visible label `Lattice` to the left of the lattice toggle.
- A lattice on/off toggle.
- A small icon-only `X` close button.

A background edit modal contains:

- Disabled left and right arrow buttons because the background is position-locked.
- The visible label `Color` above the color controls.
- A color selector with normal colors and the transparent/knockout color.
- The visible label `Alpha` above the alpha slider.
- An alpha slider from `0` to `1`.
- A small icon-only `X` close button.

A cover edit modal contains:

- A left arrow button at the top-left for moving the cover deeper/inside/left in the stack.
- A right arrow button at the top-right for moving the cover shallower/outside/right in the stack.
- The visible label `Color` above the color controls.
- A color selector with normal colors and the transparent/knockout color.
- The visible label `Alpha` above the alpha slider.
- An alpha slider from `0` to `1`.
- The visible label `Lattice` to the left of the lattice toggle.
- A lattice on/off toggle.
- A trash icon button for deleting the cover.
- A small icon-only `X` close button.

A lattice edit modal contains:

- A left arrow button at the top-left for moving the lattice deeper/inside/left in the stack.
- A right arrow button at the top-right for moving the lattice shallower/outside/right in the stack.
- The visible label `Color` above the color controls.
- A color selector with normal colors and the transparent/knockout color.
- The visible label `Alpha` above the alpha slider.
- An alpha slider from `0` to `1`.
- The visible label `Resolution` above the resolution dropdown.
- A resolution dropdown with options `20`, `80`, `320`, `1280`, and `5120`.
- The visible label `Line width` above the line-width slider.
- A line-width slider from `1` to `12`, step `0.1`, default `3`.
- The visible label `Dots` next to the intersection-points toggle.
- An intersection-points on/off toggle.
- The visible label `Dot size` above the dot-size slider.
- A dot-size slider from `1` to `12`, step `0.1`, default `4`; this slider is disabled when intersection points are off.
- A trash icon button for deleting the lattice.
- A small icon-only `X` close button.

The base lattice modal contains the same lattice controls, but both move arrows are disabled because the base lattice is locked.

The color selector's visible swatch reflects both the current color and current alpha over the app's checkerboard transparency-preview surface.

In a lattice modal, the large color selector circle renders a live full-sphere lattice preview using the lattice layer's current color mode, color, alpha, resolution, line width, intersection-dot setting, dot size, and rotation. This preview is not clipped by the source mask.

The currently active color mode is visually highlighted. In normal color mode, the normal color circle is highlighted and the transparent/knockout swatch is not. In transparent/knockout color mode, the transparent/knockout swatch is highlighted and the normal color circle is not, but the normal color circle still shows the saved normal color unchanged.

When the transparent/knockout color is selected, the color selector shows the standard checkerboard or diagonal-slash treatment, the alpha slider is set to `1`, and the alpha slider is disabled.

The color modal may show visible text only for concise control labels, toggle text, and dropdown values.

Move arrows:

- Are visible in background, base sphere, cover, and lattice modals.
- Move the current layer one stack position per press.
- Are positioned in the bottom-left and bottom-right corners of the modal so they do not interfere with the close button.
- Left moves deeper/inside/left.
- Right moves shallower/outside/right.
- Are disabled when the current layer cannot move in that direction.
- Cannot move any layer below the locked background, base sphere, or base lattice area.
- Are both disabled for the background.
- Are both disabled for the base sphere.
- Are both disabled for the base lattice.

Clicking outside a modal does not dismiss it. The `X` must be clicked or tapped to close.

## Rotation Gestures

The logo preview itself is the rotation pad.

Gesture coordinates use the browser screen basis: `+x` points right, `+y` points down, and `+z` points toward the user. Rendering coordinates use the mathematical model basis: `+x` points right, `+y` points up, and `+z` points toward the user. The implementation must convert screen-space gesture rotations into model-space matrices in one shared conversion layer.

When one or more rotatable layers are selected:

- Mouse drag or one-finger horizontal drag rotates only around the screen y-axis.
- Mouse drag or one-finger vertical drag rotates only around the screen x-axis.
- A mixed horizontal and vertical drag applies one incremental screen-axis rotation in the screen x/y plane; it must not apply ordered x-then-y or y-then-x Euler updates.
- Two-finger twist rotates only around the screen z-axis.
- On desktop, `Shift` plus a circular drag around the logo center rotates only around the screen z-axis.
- Gesture direction is screen-aligned: dragging left rotates clockwise around the y-axis, dragging right rotates counterclockwise around the y-axis, dragging down moves the cover top-to-bottom around the x-axis, dragging up moves the cover bottom-to-top around the x-axis, and clockwise twist rotates clockwise around the z-axis.
- Rotatable layer orientation is stored as a rotation matrix. Interactive gestures pre-multiply an incremental screen-axis rotation onto the current matrix and must not be represented as mutable `roll`, `pitch`, and `yaw` fields.

When no rotatable layers are selected:

- Dragging the logo does nothing.

## Roll, Pitch, And Yaw Fields

The bottom-left rotation editor contains three visible numeric fields ordered `Roll`, `Pitch`, `Yaw`.

These fields are an absolute Euler editor and viewer. They are intentionally separate from drag dynamics:

- The displayed values come from decomposing the deepest selected rotatable layer's stored rotation matrix.
- The Euler convention is the same as the original reference math: `Rz * Ry * Rx`.
- Editing these fields rebuilds an absolute Euler target matrix; it does not mutate incremental drag values.
- Interactive dragging and twisting continue to use screen-axis incremental matrix deltas.

When no rotatable layer exists or no rotatable layer is selected:

- All three fields are blank.
- All three fields are disabled.

When one or more rotatable layers are selected:

- The deepest selected rotatable layer is the reference layer shown in the fields.
- Values display with one decimal place.
- Values are kept in the inclusive range `0.0` through `360.0`.
- Displaying any valid equivalent Euler decomposition is acceptable.

Editing behavior:

- Typing into a field does not update the logo immediately.
- Pressing `Enter` commits the field.
- Blurring the field commits the field.
- Empty or invalid input reverts to the current live value.
- Values below `0` commit as `0.0`.
- Values above `360` commit as `360.0`.

When a field commit changes the deepest selected rotatable layer's absolute Euler orientation, all selected rotatable layers receive the same rotation delta:

```text
delta = targetReferenceRotation * inverse(currentReferenceRotation)
nextSelectedRotation = normalize(delta * currentSelectedRotation)
```

This makes the reference layer land on the requested absolute roll, pitch, and yaw while preserving the relative orientations among all selected rotatable layers. Unselected layers do not move.

## Baseball Cover Math

The cover shape should match the realistic seam math below. The TypeScript implementation does not need to copy this code exactly, but the mathematics and visible output should match it closely.

```python
def seam_curve(n=4000):
    a = 0.699
    b = 0.301
    t = np.linspace(0, 2 * np.pi, n)
    x = a * np.sin(t) + b * np.sin(3 * t)
    y = 2 * np.sqrt(a * b) * np.cos(2 * t)
    z = a * np.cos(t) - b * np.cos(3 * t)
    return np.vstack([x, y, z])

def rotation_matrix(roll=0, pitch=0, yaw=0):
    yaw = np.deg2rad(yaw)
    pitch = np.deg2rad(pitch)
    roll = np.deg2rad(roll)
    Rz = np.array([[np.cos(yaw), -np.sin(yaw), 0], [np.sin(yaw), np.cos(yaw), 0], [0, 0, 1]])
    Ry = np.array([[np.cos(pitch), 0, np.sin(pitch)], [0, 1, 0], [-np.sin(pitch), 0, np.cos(pitch)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(roll), -np.sin(roll)], [0, np.sin(roll), np.cos(roll)]])
    return Rz @ Ry @ Rx
```

The Python `rotation_matrix` above is only a reference for the original static seam rendering math and legacy persisted-state migration. The interactive app must store composed cover orientation as a matrix and apply screen-axis incremental rotations to that matrix.

Rendering expectations:

- Use the seam curve to define the cover half.
- Use stereographic projection equivalent to `x / (1 + z), y / (1 + z)` for inside/outside testing.
- Rotate the seam using each cover's stored rotation matrix.
- Only draw portions visible from the front 2D snapshot.
- In solid mode, build filled visible polygons using front-facing seam arcs and visible silhouette arcs.
- In solid mode, draw the full circle in the rare case where the entire visible ball is one piece.
- In transparent/knockout color mode, use the same visible filled geometry as solid mode, but erase already-rendered pixels instead of drawing color.
- Do not expose an invert toggle in the UI.

## Lattice Rendering

Lattice rendering uses independent icosphere lattice layers. It does not use the abandoned flat leather-pattern lattice, horizontal regions, greedy graph construction, or cutout-boundary dot generation.

Icosphere resolutions:

- `20` uses the base icosahedron with 20 triangular faces.
- `80` uses one subdivision of the base icosahedron.
- `320` uses two subdivisions of the base icosahedron.
- `1280` uses three subdivisions of the base icosahedron.
- `5120` uses four subdivisions of the base icosahedron.
- All five icosphere edge sets should be deterministic and precalculated or memoized.
- Duplicate undirected edges must be removed before rendering.

A lattice layer:

- Is created when its source layer's lattice toggle is on.
- Is initially inserted immediately to the right/outside of its source layer, except the base lattice is inserted immediately above the base sphere.
- Is drawn as triangle lattice lines over the entire sphere, clipped by the source layer's mask.
- Has transparent gaps between lattice lines.
- Draws the cookie-cutter outline of the source mask.
- Uses the same line width for triangle lattice lines and the cookie-cutter outline.
- Uses its own color mode, color, alpha, resolution, line width, intersection-dot setting, and dot size.
- Has its own rotation matrix independent from the source layer's rotation.
- Can be selected and rotated like a cover source layer.
- Can be edited by long-pressing its row preview.
- Can be deleted from its own modal.

Source masks:

- The source layer controls which portions of its paired lattice layer are visible.
- The source layer and lattice layer can be rotated independently.
- If both are selected, a drag rotates both together and preserves their relative orientation.
- If only the source layer is selected, dragging changes the cookie-cutter mask without changing the lattice's own spherical grid orientation.
- If only the lattice layer is selected, dragging changes the spherical grid orientation without changing the cookie-cutter mask.
- For the base sphere source, the mask is the full visible front circle of the sphere.
- For a cover source, the mask is exactly the visible front-view shape that the cover would draw in solid mode for its current rotation.
- A source layer with lattice enabled remains visible in the main logo.
- A source layer with lattice enabled remains fully visible in the layer row using its current color mode, color, alpha, and source geometry preview.

Rendering a lattice layer:

- Start from the selected precalculated icosphere edge set.
- Apply the lattice layer's rotation matrix to each spherical edge.
- Sample each edge along its great-circle path densely enough that clipping looks smooth.
- Discard portions of sampled paths whose rotated points are on the back side of the sphere.
- Project front-facing samples to the 2D logo plane.
- Clip the remaining projected path portions to the source layer's current visible mask.
- In normal color mode, draw the surviving lattice path portions with the lattice layer's color, alpha, and line width.
- In normal color mode, draw the source layer's current visible mask boundary as the cookie-cutter outline with the lattice layer's color, alpha, and line width.
- In transparent/knockout color mode, use the same lattice path portions and cookie-cutter outline, but erase already-rendered pixels instead of drawing color.
- If the source mask has multiple visible pieces, draw the outline for each piece and clip lattice paths to the union of those pieces.
- When intersection points are enabled, draw complete circular dots at visible icosphere vertices whose centers are inside the source mask.
- Do not draw dots for intersections created by clipping lattice edges against the cookie-cutter outline.
- In normal color mode, dot color and alpha match the lattice layer's color and alpha.
- Dots are drawn after lattice lines and the cookie-cutter outline.
- Dots are not clipped by the source mask; if a dot center is visible and inside the mask, the full circular dot is drawn.
- In transparent/knockout color mode, enabled dots erase already-rendered pixels instead of drawing color.

## Icosphere Preview Generator

The standalone generator in `scripts/generate-icosphere-lattice-previews.mjs` generates approval images for the spherical-lattice approach.

The prototype output directory is `icosphere-output/`.

The prototype should generate:

- One full-sphere lattice image for each resolution: `20`, `80`, `320`, `1280`, and `5120`.
- At least two cover-mask cutout images for each resolution.
- Each cover-mask image should show an independently rotated spherical lattice clipped by an independently rotated cover source mask.
- Each cover-mask image should draw the source mask's cookie-cutter outline at the same width as the lattice lines.
- Prototype images may include variants with intersection points enabled and disabled.
- Prototype images should draw no source-layer fill unless specifically testing layer composition.

## Save And Export

The save icon opens a save modal.

The save modal contains:

- A filename input showing `logo.png`.
- A circular confirm button with a check mark.
- A small icon-only `X` close button.

The only visible text in the save modal is the filename text.

When the save modal opens:

- The input value is `logo.png` by default.
- Only the `logo` stem is selected for editing.
- The `.png` extension remains visible but unselected.

Clicking outside the save modal does not dismiss it. The `X` must be clicked or tapped to close.

Confirming the save:

- Downloads the current logo as a PNG.
- Appends `.png` if the filename does not already end with `.png`.
- Produces a square `1024x1024` image.
- Draws the editable background layer across the full square export canvas.
- Does not draw any implicit background beneath the editable background layer.
- Produces transparent pixels anywhere the editable background layer and logo layers do not draw opaque content.
- Produces transparent pixels in the background area when the editable background alpha is `0`.
- Produces transparent pixels in the background area when the editable background uses transparent/knockout color mode.
- Centers the circular logo.
- Leaves `14%` buffer around the logo circle on every side; this buffer shows only the editable background layer.

## Persistence

The app stores its editable state in `localStorage`.

Persisted state includes:

- Background color, color mode, and alpha.
- Base sphere color, color mode, and alpha.
- Base sphere rotation.
- Base sphere selected state.
- Base sphere lattice enabled state.
- Cover layer list.
- Cover layer colors, color modes, and alphas.
- Cover layer rotations.
- Cover layer selected states.
- Cover layer stack order.
- Cover layer lattice enabled states.
- Lattice layer color, color mode, alpha, resolution, line width, intersection-dot setting, dot size, rotation, selected state, source link, and stack order.

The app should tolerate missing, malformed, or older persisted data by falling back to valid defaults. Existing persisted source layers without lattice state load with lattice disabled.

## Visual Constraints

- Main-screen text is limited to the `Roll`, `Pitch`, and `Yaw` rotation fields.
- The color modal may show visible text only for concise control labels, toggle text, and dropdown values.
- The save modal's only visible text is the filename.
- Do not use decorative text, headings, help copy, tooltips with visible text, or visible keyboard shortcut hints.
- Use icon-only controls where controls are needed.
- Keep the visual design minimal, with a checkerboard editor surface and quiet white controls.
- Do not draw outlines around the logo unless a layer fill itself creates a visible boundary.
- Do not use visible seam strokes.
- Lattice layers may draw visible cookie-cutter outlines because the outline is part of the lattice layer.
- Lattice layers may draw visible intersection dots only when enabled in the lattice modal.
- Transparent/knockout color must be visually discoverable in controls and layer swatches with a checkerboard or diagonal-slash treatment.

## Verification

The app should include screenshot-oriented verification similar in spirit to `../qwixx`.

Verification should:

- Start Vite on a fixed local port.
- Use Playwright.
- Capture mobile and desktop screenshots into `verification-output/`.
- Capture named screenshots for the main checkerboard surface, background modal, base modal, cover modal, cover lattice modal, base lattice modal, dots-on lattice, lattice knockout, cover knockout, transparent-background preview, reordered layers, and the existing main/save modal states.
- Verify the app shell uses the checkerboard transparency-preview surface.
- Verify the top layer panel and bottom rotation/save panel are full-width opaque white panels.
- Verify transparent and partially transparent editable backgrounds reveal the checkerboard in the editor preview.
- Verify the editable background preview extends across the middle work area while the logo canvas size and export size remain unchanged.
- Verify the checkerboard is editor-only and is not baked into exported PNG pixels.
- Verify the initial canvas is not blank after rendering.
- Verify the main screen's only visible text is the `Roll`, `Pitch`, and `Yaw` rotation editor.
- Verify initial selected cover fields show `0.0`.
- Verify fields are blank and disabled when no rotatable layer is selected.
- Verify dragging a selected rotatable layer updates the displayed Euler values.
- Verify typing into an Euler field does not mutate the logo before `Enter` or blur.
- Verify `Enter` and blur both commit Euler edits.
- Verify Euler field commits clamp below `0` to `0.0` and above `360` to `360.0`.
- Verify Euler field edits apply the same matrix delta to all selected rotatable layers and do not move unselected layers.
- Verify the background square swatch selects all rotatable layers when any rotatable layer is unselected.
- Verify the background square swatch clears all rotatable layer selections when all rotatable layers are selected.
- Verify the background layer is never visually shown as selected.
- Verify the base sphere can be selected, deselected, rotated, edited, and shown as selected.
- Verify every drawable layer can choose normal color mode or transparent/knockout color mode.
- Verify choosing transparent/knockout color sets alpha to `1` and disables the alpha slider.
- Verify switching from transparent/knockout color back to a normal color keeps alpha at `1` and re-enables the alpha slider.
- Verify alpha `0` makes a layer invisible without erasing lower layers.
- Verify transparent/knockout color erases only already-rendered lower layers and does not erase layers above it.
- Verify transparent/knockout color affects only visible drawn geometry.
- Verify transparent/knockout lattice layers erase only lattice lines, cookie-cutter outlines, and enabled intersection dots; lattice gaps do not erase lower layers.
- Verify transparent/knockout swatches are discoverable in the layer row and color selector.
- Verify the currently active color mode is visually highlighted in the color selector, and the inactive color mode is not highlighted.
- Verify each source layer defaults to lattice disabled.
- Verify the base sphere and cover color modals can toggle lattice on and off.
- Verify toggling lattice on creates a lattice layer with default resolution `320`, line width `3`, dots off, dot size `4`, and source color mode/color/alpha copied at creation time.
- Verify toggling lattice off from the source modal deletes the paired lattice layer.
- Verify a lattice modal can edit lattice color mode, color, alpha, resolution, line width, intersection-dot setting, and dot size independently from the source layer.
- Verify a lattice modal can delete the lattice layer.
- Verify the lattice line-width slider has range `1` through `12`.
- Verify the dot-size slider has range `1` through `12` and is disabled when intersection points are off.
- Verify deleting a lattice from its own modal removes only that lattice layer.
- Verify source layer color mode, color, and alpha changes do not update an existing lattice layer.
- Verify a source layer with lattice enabled remains visible in the logo and in the layer row.
- Verify a lattice layer draws triangle lines and a cookie-cutter outline with no fill.
- Verify intersection dots render only for visible icosphere vertices inside the source mask and not for cutout-boundary intersections.
- Verify base-sphere lattice masks cover the full visible front circle.
- Verify cover-source lattice masks match the visible cover shape for the source layer's independent rotation.
- Verify lattice layers can be selected, deselected, edited by long-press, and rotated independently from their source layers.
- Verify selecting both a source layer and its lattice layer rotates both together.
- Verify deleting a cover source layer deletes its paired lattice layer.
- Verify lattice layer settings, rotations, selection states, and stack positions persist through reload.
- Verify exported PNG includes source fills and lattice layers.
- Verify cover and lattice modal move arrows are visible and disabled when movement is blocked.
- Verify moving a cover source changes only that cover source's stack position.
- Verify moving a cover lattice changes only that lattice layer's stack position.
- Verify the top row and render order match the explicit stack order.
- Verify the background, base sphere, and base lattice cannot move and nothing can move below them.
- Verify the background modal edits only background color mode, color, and alpha.
- Add a cover layer and confirm it starts selected.
- Rotate a selected layer and verify rendered pixels change.
- Verify dragging with no selected layers does not change rendered pixels.
- Open the color modal via long-press and capture a screenshot.
- Verify source color modals only expose a lattice toggle, not lattice styling controls.
- Verify lattice color modals expose lattice styling controls.
- Verify source color modals show the approved source labels and do not expose lattice styling labels.
- Verify lattice color modals show the approved lattice labels plus resolution values.
- Verify the lattice modal's live color preview circle renders a full-sphere lattice and changes when lattice color, alpha, resolution, line width, intersection-dot setting, and dot size change.
- Open the save modal and verify `logo.png` is visible.
- Verify only the `logo` filename stem is selected when the save modal opens.
- Verify export produces a `1024x1024` PNG using the editable background layer and no implicit background beneath it.
- Verify export can produce transparent pixels when the editable background alpha is `0`.
- Verify export can produce transparent pixels when the editable background uses transparent/knockout color mode.
- Exercise both mobile and desktop viewports.

Verification output screenshots are generated artifacts and are not the source of truth. This document remains the source of truth.

## Deployment

The app is deployed to GitHub Pages from `main` through `.github/workflows/deploy.yml`.

The deployment workflow should:

- Install dependencies with `npm ci`.
- Build the app with `npm run build`.
- Include the root `.nojekyll` marker so GitHub Pages serves the built static assets without Jekyll processing.
- Upload the generated `dist/` directory as the GitHub Pages artifact.
- Deploy that artifact to GitHub Pages.

Screenshot verification is a local preflight and should not block the final GitHub Pages publish workflow.

The published app URL is expected to be `https://tristanmott1.github.io/logo/`.

## Documentation Change Rule

When app behavior changes, update this document in the same change.

If implementation and this document disagree, this document wins until it is explicitly changed.
