# Logo Builder PWA Specification

This document is the source of truth for the app. Any future change to the product, interaction model, rendering behavior, export behavior, or verification expectations should update this document in the same change.

## Purpose

Build an extremely simple installable PWA for creating a logo: a centered 2D image of a sphere with one or more realistic baseball-cover halves layered over it.

The app is a visual instrument, not a form-driven editor. The main screen should contain no visible text.

## Product Shape

- The app is a PWA modeled after the structure of `../qwixx`.
- The implementation target is React, TypeScript, Vite, and Canvas 2D.
- The app should work well on touch devices and desktop browsers.
- The app background is white.
- The final exported logo has a transparent background.
- The app persists its state locally and restores it on reload.

## Main Screen

The main screen has only these visible elements:

- A top row of layer controls.
- A plus icon for adding a cover layer.
- The logo preview centered on the screen.
- A save icon near the bottom-right of the screen.

No other visible text is allowed on the main screen.

Accessible names may be present through `aria-label` or equivalent hidden metadata. These labels must not be visually rendered.

## Layers

The app starts with:

- One base sphere layer.
- One cover layer.

The base sphere:

- Is always the first item in the top layer row.
- Is a complete filled circle, not a partial cover.
- Defaults to white with alpha `1`.
- Is flat, with no shading.
- Has no outline or visible boundary beyond its fill.
- Is never visually shown as selected.
- Cannot be deleted.
- Can be edited by long-pressing its top-row circle.

Cover layers:

- Represent one half of a realistic baseball cover.
- Default to black with alpha `1`.
- Are drawn in add-order depth: deepest on the left, surface-most on the right.
- Are filled shapes only, with no seam lines, strokes, outlines, or edge marks.
- Can be added with the plus icon.
- A newly added cover starts selected.
- Can be edited by long-pressing its top-row circle.
- Can be deleted from the edit modal.

## Layer Row

The layer row:

- Appears at the top of the app.
- Shows a circular swatch for the base sphere.
- Shows each cover layer as the actual visible front-view shape of that cover.
- Shows the base sphere at far left.
- Shows cover layers from deepest to surface-most left-to-right.
- Shows a plus icon at far right.
- Uses each layer's current color, alpha, and cover rotation in its row preview.
- May use subtle backing inside or behind layer controls so transparent or white layers remain discoverable.
- Shows selected cover layers with a visual ring or equivalent icon-free treatment.
- Does not show the base sphere as selected.

## Selection

Multiple cover layers may be selected at once.

Clicking or tapping a cover swatch:

- Toggles only that cover's selected state.
- Does not affect any other cover.

Clicking or tapping the base sphere swatch:

- Selects all cover layers if any cover layer is currently unselected.
- Clears all cover selections if all cover layers are already selected.
- Does not visually select the base sphere itself.

Dragging the logo:

- Rotates selected cover layers only.
- Does nothing when no cover layers are selected.
- Does not rotate the base sphere.

## Long-Press Editing

Long-pressing a swatch opens a modal for that layer.

The modal must not open from a normal quick click.

Pointer movement beyond the drag threshold cancels long-press opening.

The base sphere edit modal contains:

- A color selector.
- An alpha slider from `0` to `1`.
- A small icon-only `X` close button.

A cover edit modal contains:

- A color selector.
- An alpha slider from `0` to `1`.
- A trash icon button for deleting the cover.
- A small icon-only `X` close button.

The color modal has no visible text.

Clicking outside a modal does not dismiss it. The `X` must be clicked or tapped to close.

## Rotation Gestures

The logo preview itself is the rotation pad.

When one or more cover layers are selected:

- Mouse drag or one-finger horizontal drag changes pitch, spinning on a vertical axis.
- Mouse drag or one-finger vertical drag changes roll, rolling toward or away from the viewer.
- Two-finger twist changes yaw, rotating on an axis orthogonal to the screen.
- On desktop, `Shift` plus drag changes yaw.

When no cover layers are selected:

- Dragging the logo does nothing.

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

Rendering expectations:

- Use the seam curve to define the cover half.
- Use stereographic projection equivalent to `x / (1 + z), y / (1 + z)` for inside/outside testing.
- Rotate the seam using roll, pitch, and yaw.
- Only draw portions visible from the front 2D snapshot.
- Build filled visible polygons using front-facing seam arcs and visible silhouette arcs.
- In the rare case where the entire visible ball is one piece, draw the full circle.
- Do not expose an invert toggle in the UI.

## Save And Export

The save icon opens a save modal.

The save modal contains:

- A filename input showing `logo.png`.
- A circular confirm button with a check mark.
- A small icon-only `X` close button.

The only visible text in the app is the filename text shown in the save modal.

When the save modal opens:

- The input value is `logo.png` by default.
- Only the `logo` stem is selected for editing.
- The `.png` extension remains visible but unselected.

Clicking outside the save modal does not dismiss it. The `X` must be clicked or tapped to close.

Confirming the save:

- Downloads the current logo as a PNG.
- Appends `.png` if the filename does not already end with `.png`.
- Produces a square `1024x1024` image.
- Uses a transparent background.
- Centers the circular logo.
- Leaves `14%` transparent buffer around the logo circle on every side.

## Persistence

The app stores its editable state in `localStorage`.

Persisted state includes:

- Base sphere color and alpha.
- Cover layer list.
- Cover layer colors and alphas.
- Cover layer rotations.
- Cover layer selected states.

The app should tolerate missing, malformed, or older persisted data by falling back to valid defaults.

## Visual Constraints

- The main screen has no visible text.
- The color modal has no visible text.
- The only visible text anywhere in the app is the filename in the save modal.
- Do not use decorative text, headings, help copy, tooltips with visible text, or visible keyboard shortcut hints.
- Use icon-only controls where controls are needed.
- Keep the visual design minimal and white.
- Do not draw outlines around the logo unless a layer fill itself creates a visible boundary.
- Do not use visible seam strokes.

## Verification

The app should include screenshot-oriented verification similar in spirit to `../qwixx`.

Verification should:

- Start Vite on a fixed local port.
- Use Playwright.
- Capture mobile and desktop screenshots into `verification-output/`.
- Verify the initial canvas is not blank after rendering.
- Verify the main screen has no visible text.
- Add a cover layer and confirm it starts selected.
- Rotate a selected layer and verify rendered pixels change.
- Verify dragging with no selected layers does not change rendered pixels.
- Open the color modal via long-press and capture a screenshot.
- Verify the color modal has no visible text.
- Open the save modal and verify `logo.png` is visible.
- Verify only the `logo` filename stem is selected when the save modal opens.
- Verify export produces a `1024x1024` PNG with transparent pixels outside the logo buffer.
- Exercise both mobile and desktop viewports.

Verification output screenshots are generated artifacts and are not the source of truth. This document remains the source of truth.

## Deployment

The app is deployed to GitHub Pages from `main` through `.github/workflows/publish-pages.yml`.

The deployment workflow should:

- Install dependencies with `npm ci`.
- Install Playwright Chromium for screenshot verification.
- Build the app with `npm run build`.
- Verify the app with `npm run verify:ui`.
- Include the root `.nojekyll` marker so GitHub Pages serves the built static assets without Jekyll processing.
- Upload the generated `dist/` directory as the GitHub Pages artifact.
- Deploy that artifact to GitHub Pages.

The published app URL is expected to be `https://tristanmott1.github.io/logo/`.

## Documentation Change Rule

When app behavior changes, update this document in the same change.

If implementation and this document disagree, this document wins until it is explicitly changed.
