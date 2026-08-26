# Logo Builder PWA Specification

This document is the source of truth for the app. Any future change to the product, interaction model, rendering behavior, export behavior, or verification expectations should update this document in the same change.

## Purpose

Build an extremely simple installable PWA for creating a logo: a centered 2D image of a sphere with one or more realistic baseball-cover halves layered over it.

The app is a visual instrument with one compact numeric rotation editor. Visible main-screen text is limited to the `Roll`, `Pitch`, and `Yaw` field labels and values.

## Product Shape

- The app is a PWA modeled after the structure of `../qwixx`.
- The implementation target is React, TypeScript, Vite, and Canvas 2D.
- The app should work well on touch devices and desktop browsers.
- The app background is white.
- The final exported logo has a white background.
- The app persists its state locally and restores it on reload.

## Main Screen

The main screen has only these visible elements:

- A top row of layer controls.
- A plus icon for adding a cover layer.
- The logo preview centered on the screen.
- Compact `Roll`, `Pitch`, and `Yaw` fields starting at the bottom-left of the screen.
- A save icon near the bottom-right of the screen.

No other visible text is allowed on the main screen.

Accessible names may be present through `aria-label` or equivalent hidden metadata. These labels must not be visually rendered.

## Layers

The app starts with:

- One base sphere layer.
- One cover layer.

The base sphere:

- Is always the first item in the top layer row.
- Is a complete sphere, not a partial cover.
- Defaults to white with alpha `1`.
- Is flat, with no shading.
- Has no outline or visible boundary beyond its fill.
- Defaults to lattice option `None`.
- Can choose lattice option `None`, `20`, `80`, `320`, `1280`, or `5120`.
- Is never visually shown as selected.
- Cannot be deleted.
- Can be edited by long-pressing its top-row circle.

Cover layers:

- Represent one half of a realistic baseball cover.
- Default to black with alpha `1`.
- Are drawn in add-order depth: deepest on the left, surface-most on the right.
- Are filled shapes only when lattice option is `None`, with no seam lines, strokes, outlines, or edge marks.
- Default to lattice option `None`.
- Can choose lattice option `None`, `20`, `80`, `320`, `1280`, or `5120`.
- Can be added with the plus icon.
- A newly added cover starts selected.
- Can be edited by long-pressing its top-row circle.
- Can be deleted from the edit modal.

Lattice options:

- `None` means no generated lattice layer exists for that source layer.
- `20`, `80`, `320`, `1280`, and `5120` create a generated lattice layer with that many triangles over the entire sphere.
- Lattice triangle counts correspond to precalculated icosphere resolutions.
- A source layer owns its lattice option, color, alpha, line width, and mask geometry.
- A generated lattice layer inherits color and alpha live from its source layer.
- A generated lattice layer stores only its own rotation and selection state.
- When a source layer's lattice option is not `None`, the source layer itself is hidden in the main logo but remains fully visible in the top layer row.
- The generated lattice layer is shown immediately to the right of its source layer in the top layer row and in render order.
- Changing a lattice option between `20`, `80`, `320`, `1280`, and `5120` keeps the generated lattice layer's current rotation and selection state.
- Changing a lattice option back to `None` removes the generated lattice layer.
- Deleting a source cover layer also deletes its generated lattice layer.

## Layer Row

The layer row:

- Appears at the top of the app.
- Shows a circular swatch for the base sphere.
- Shows each cover layer as the actual visible front-view shape of that cover.
- Shows each generated lattice layer as a clipped preview of its spherical triangle lattice inside the source layer's current mask.
- Shows the base sphere at far left.
- Shows cover source layers from deepest to surface-most left-to-right.
- Shows each generated lattice layer immediately to the right of its source layer.
- Shows a plus icon at far right.
- Uses each source layer's current color, alpha, and lattice option in its row preview.
- Uses each cover source layer's current rotation in its row preview.
- Uses each generated lattice layer's current rotation in its row preview.
- Uses the same white visual background as the app; transparent or white layers remain discoverable only through the control border, shadow, and selected cover ring.
- Shows selected cover and generated lattice layers with a visual ring or equivalent icon-free treatment.
- Does not show the base sphere as selected.

## Selection

Multiple rotatable layers may be selected at once. Rotatable layers include cover source layers and generated lattice layers. The base sphere source layer is never selected.

Clicking or tapping a cover swatch:

- Toggles only that cover's selected state.
- Does not affect any other layer.

Clicking or tapping a generated lattice layer swatch:

- Toggles only that generated lattice layer's selected state.
- Does not affect any other layer.

Clicking or tapping the base sphere swatch:

- Selects all rotatable layers if any rotatable layer is currently unselected.
- Clears all rotatable layer selections if all rotatable layers are already selected.
- Does not visually select the base sphere itself.

Dragging the logo:

- Rotates selected rotatable layers only.
- Does nothing when no rotatable layers are selected.
- Does not rotate the base sphere.

When a source layer's lattice option changes from `None` to a triangle count:

- The generated lattice layer is created immediately to the right of the source layer.
- For the base sphere source, only the generated lattice layer becomes selected.
- For a cover source, the source layer and generated lattice layer both become selected.
- Other existing selections are preserved.

## Long-Press Editing

Long-pressing a swatch opens a modal for that layer.

The modal must not open from a normal quick click.

Pointer movement beyond the drag threshold cancels long-press opening.

The base sphere edit modal contains:

- A color selector.
- An alpha slider from `0` to `1`.
- A lattice dropdown with options `None`, `20`, `80`, `320`, `1280`, and `5120`.
- A line-width slider from `1` to `12`, step `0.1`, default `3`; this slider is disabled when lattice option is `None`.
- A small icon-only `X` close button.

A cover edit modal contains:

- A color selector.
- An alpha slider from `0` to `1`.
- A lattice dropdown with options `None`, `20`, `80`, `320`, `1280`, and `5120`.
- A line-width slider from `1` to `12`, step `0.1`, default `3`; this slider is disabled when lattice option is `None`.
- A trash icon button for deleting the cover.
- A small icon-only `X` close button.

Long-pressing a generated lattice layer swatch does nothing.

The color selector's visible swatch reflects both the current color and current alpha over the app's white background.

The color modal may show visible text only inside the lattice dropdown values.

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
- Do not expose an invert toggle in the UI.

## Lattice Rendering

Lattice rendering uses generated icosphere layers. It does not use a flat leather-pattern lattice, dot placement, horizontal regions, or greedy graph construction.

Icosphere resolutions:

- `20` uses the base icosahedron with 20 triangular faces.
- `80` uses one subdivision of the base icosahedron.
- `320` uses two subdivisions of the base icosahedron.
- `1280` uses three subdivisions of the base icosahedron.
- `5120` uses four subdivisions of the base icosahedron.
- All four icosphere edge sets should be deterministic and precalculated or memoized.
- Duplicate undirected edges must be removed before rendering.

A generated lattice layer:

- Is created when its source layer's lattice option is `20`, `80`, `320`, `1280`, or `5120`.
- Appears immediately to the right of its source layer.
- Is drawn as triangle lattice lines over the entire sphere, clipped by the source layer's mask.
- Has transparent gaps between lattice lines.
- Draws no dots.
- Draws the cookie-cutter outline of the source mask.
- Uses the same line width for triangle lattice lines and the cookie-cutter outline.
- Uses the source layer's current color and alpha for both lattice lines and outline.
- Has its own rotation matrix independent from the source layer's rotation.
- Can be selected and rotated like a cover source layer.
- Cannot be edited by long-press; long-pressing its row preview does nothing.

Source masks:

- The source layer controls which portions of its paired lattice layer are visible.
- The source layer and generated lattice layer can be rotated independently.
- If both are selected, a drag rotates both together and preserves their relative orientation.
- If only the source layer is selected, dragging changes the cookie-cutter mask without changing the lattice's own spherical grid orientation.
- If only the generated lattice layer is selected, dragging changes the spherical grid orientation without changing the cookie-cutter mask.
- For the base sphere source, the mask is the full visible front circle of the sphere.
- For a cover source, the mask is exactly the visible front-view shape that the cover would draw in solid mode for its current rotation.
- A source layer with lattice option enabled is hidden in the main logo, but its mask is still used to clip its generated lattice layer.
- A source layer with lattice option enabled remains fully visible in the layer row using its current color, alpha, and source geometry preview.

Rendering a generated lattice layer:

- Start from the selected precalculated icosphere edge set.
- Apply the generated lattice layer's rotation matrix to each spherical edge.
- Sample each edge along its great-circle path densely enough that clipping looks smooth.
- Discard portions of sampled paths whose rotated points are on the back side of the sphere.
- Project front-facing samples to the 2D logo plane.
- Clip the remaining projected path portions to the source layer's current visible mask.
- Draw the surviving lattice path portions with the source layer's color and alpha.
- Draw the source layer's current visible mask boundary as the cookie-cutter outline with the same color, alpha, and line width.
- If the source mask has multiple visible pieces, draw the outline for each piece and clip lattice paths to the union of those pieces.

## Current Icosphere Prototype Phase

Before app integration, the standalone generator in `scripts/generate-icosphere-lattice-previews.mjs` should generate approval images for the new spherical-lattice approach.

The prototype output directory is `icosphere-output/`.

The prototype should generate:

- One full-sphere lattice image for each resolution: `20`, `80`, `320`, `1280`, and `5120`.
- At least two cover-mask cutout images for each resolution.
- Each cover-mask image should show an independently rotated spherical lattice clipped by an independently rotated cover source mask.
- Each cover-mask image should draw the source mask's cookie-cutter outline at the same width as the lattice lines.
- Prototype images should draw no dots and no source-layer fill.

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
- Uses a white background.
- Centers the circular logo.
- Leaves `14%` white buffer around the logo circle on every side.

## Persistence

The app stores its editable state in `localStorage`.

Persisted state includes:

- Base sphere color and alpha.
- Base sphere lattice option.
- Base sphere line width.
- Cover layer list.
- Cover layer colors and alphas.
- Cover layer lattice options.
- Cover layer line widths.
- Cover layer rotations.
- Cover layer selected states.
- Generated lattice layer rotations and selected states when their source layers have lattice options enabled.

The app should tolerate missing, malformed, or older persisted data by falling back to valid defaults. Existing persisted source layers without a lattice option load as `None`.

## Visual Constraints

- Main-screen text is limited to the `Roll`, `Pitch`, and `Yaw` rotation fields.
- The color modal may show visible text only inside the lattice dropdown values.
- The save modal's only visible text is the filename.
- Do not use decorative text, headings, help copy, tooltips with visible text, or visible keyboard shortcut hints.
- Use icon-only controls where controls are needed.
- Keep the visual design minimal and white.
- Do not draw outlines around the logo unless a layer fill itself creates a visible boundary.
- Do not use visible seam strokes.
- Generated lattice layers may draw visible cookie-cutter outlines because the outline is part of the lattice layer.

## Verification

The app should include screenshot-oriented verification similar in spirit to `../qwixx`.

Verification should:

- Start Vite on a fixed local port.
- Use Playwright.
- Capture mobile and desktop screenshots into `verification-output/`.
- Verify the initial canvas is not blank after rendering.
- Verify the main screen's only visible text is the `Roll`, `Pitch`, and `Yaw` rotation editor.
- Verify initial selected cover fields show `0.0`.
- Verify fields are blank and disabled when no cover layer is selected.
- Verify dragging a selected cover updates the displayed Euler values.
- Verify typing into an Euler field does not mutate the logo before `Enter` or blur.
- Verify `Enter` and blur both commit Euler edits.
- Verify Euler field commits clamp below `0` to `0.0` and above `360` to `360.0`.
- Verify Euler field edits apply the same matrix delta to all selected rotatable layers and do not move unselected layers.
- Verify each source layer defaults to lattice option `None`.
- Verify the base sphere and cover color modals can choose lattice options `None`, `20`, `80`, `320`, `1280`, and `5120`.
- Verify the line-width slider defaults to `3`, has range `1` through `12`, and is disabled when lattice option is `None`.
- Verify choosing a non-`None` lattice option creates a generated lattice layer immediately to the right of its source layer.
- Verify choosing `None` removes the generated lattice layer.
- Verify changing between non-`None` lattice options preserves the generated lattice layer's rotation and selection state.
- Verify source layer color and alpha changes update the generated lattice layer live.
- Verify a source layer with lattice enabled is hidden in the logo but remains visible in the layer row.
- Verify a generated lattice layer draws triangle lines and a cookie-cutter outline with no dots and no fill.
- Verify base-sphere lattice masks cover the full visible front circle.
- Verify cover-source lattice masks match the visible cover shape for the source layer's independent rotation.
- Verify generated lattice layers can be selected, deselected, and rotated independently from their source layers.
- Verify selecting both a source layer and its generated lattice layer rotates both together.
- Verify long-pressing a generated lattice layer does not open a modal.
- Verify deleting a cover source layer deletes its generated lattice layer.
- Verify lattice options and generated lattice layer rotations persist through reload.
- Verify exported PNG includes generated lattice layers and excludes hidden source fills.
- Add a cover layer and confirm it starts selected.
- Rotate a selected layer and verify rendered pixels change.
- Verify dragging with no selected layers does not change rendered pixels.
- Open the color modal via long-press and capture a screenshot.
- Verify the color modal's only visible text is inside the lattice dropdown values.
- Open the save modal and verify `logo.png` is visible.
- Verify only the `logo` filename stem is selected when the save modal opens.
- Verify export produces a `1024x1024` PNG with white pixels outside the logo buffer.
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
