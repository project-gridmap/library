// A repeating tonal rhythm, not a progression in importance.
export function sectionSurfaceOpacity(index, opacity = 0.08, variation = 0.125) {
  const amount = Math.min(1, Math.max(0, variation));
  return Math.min(1, Math.max(0, opacity * [1 - amount, 1 + amount, 1][index % 3]));
}

// Resolve through Canvas so every supported CSS colour (including alpha and
// non-hex colours) uses the same compositing as the map itself. Cache the few
// palette combinations, rather than reading pixels during every animation.
let context;
const cache = new Map();
export function surfaceColour(colour, background, opacity = 0.08) {
  if (!colour || opacity <= 0) return background;
  const strength = Math.min(1, Math.max(0, opacity));
  const key = JSON.stringify([colour, background, strength]);
  if (cache.has(key)) return cache.get(key);
  if (!context) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    context = canvas.getContext('2d', { willReadFrequently: true });
  }
  context.clearRect(0, 0, 1, 1);
  context.globalAlpha = 1;
  context.fillStyle = background;
  context.fillRect(0, 0, 1, 1);
  context.globalAlpha = strength;
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  const result = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  if (cache.size >= 512) cache.clear();
  cache.set(key, result);
  return result;
}
