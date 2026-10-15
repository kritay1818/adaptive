"use strict";
const MIN_WIDTH = 110,
  MAX_WIDTH = 260,
  DEFAULT_WIDTH = 130;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function fitPet(saved, area) {
  const max = Math.max(1, Math.min(MAX_WIDTH, area.width, area.height - 48));
  const width = clamp(
    Math.round(Number.isFinite(saved?.width) ? saved.width : DEFAULT_WIDTH),
    Math.min(MIN_WIDTH, max),
    max,
  );
  const height = width + 48;
  return {
    x: clamp(
      Math.round(
        Number.isFinite(saved?.x) ? saved.x : area.x + area.width - width - 20,
      ),
      area.x,
      area.x + area.width - width,
    ),
    y: clamp(
      Math.round(
        Number.isFinite(saved?.y)
          ? saved.y
          : area.y + area.height - height - 20,
      ),
      area.y,
      area.y + area.height - height,
    ),
    width,
    height,
  };
}
module.exports = { fitPet, MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH };
