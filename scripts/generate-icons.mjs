import { writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

for (const size of [192, 512]) {
  const png = new PNG({ width: size, height: size });
  const center = size / 2;
  const circleRadius = size * 0.34;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (size * y + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const roundedRectRadius = size * 0.18;
      const inMiddleBand = x >= roundedRectRadius && x < size - roundedRectRadius;
      const inVerticalBand = y >= roundedRectRadius && y < size - roundedRectRadius;
      const insideRoundedRect =
        inMiddleBand ||
        inVerticalBand ||
        roundedDistance(x, y, roundedRectRadius, roundedRectRadius) <= roundedRectRadius ||
        roundedDistance(x, y, size - roundedRectRadius, roundedRectRadius) <= roundedRectRadius ||
        roundedDistance(x, y, roundedRectRadius, size - roundedRectRadius) <= roundedRectRadius ||
        roundedDistance(x, y, size - roundedRectRadius, size - roundedRectRadius) <= roundedRectRadius;

      if (!insideRoundedRect) {
        setPixel(png, index, 255, 255, 255, 0);
        continue;
      }

      let red = 255;
      let green = 255;
      let blue = 255;
      let alpha = 255;
      const nx = dx / circleRadius;
      const ny = -dy / circleRadius;
      const outer = nx * nx + ny * ny <= 1;
      const inner = (nx / 0.7) ** 2 + ((ny + 0.08) / 0.98) ** 2 <= 1;
      const taperedBottom = ny > -0.86 + Math.abs(nx) * 0.18;
      const inCover = outer && !inner && taperedBottom;

      if (inCover) {
        red = 17;
        green = 17;
        blue = 17;
      }

      setPixel(png, index, red, green, blue, alpha);
    }
  }

  await writeFile(new URL(`../public/icon-${size}.png`, import.meta.url), PNG.sync.write(png));
}

function setPixel(png, index, red, green, blue, alpha) {
  png.data[index] = red;
  png.data[index + 1] = green;
  png.data[index + 2] = blue;
  png.data[index + 3] = alpha;
}

function roundedDistance(x, y, cornerX, cornerY) {
  return Math.hypot(x - cornerX, y - cornerY);
}
