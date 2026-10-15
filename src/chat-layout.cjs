"use strict";
// Main owns geometry. Renderer may request only a finite semantic surface.
const heights = Object.freeze({
  compact: 64,
  notice: 144,
  review: 640,
  multiline: 156,
  conversation: 520,
  settings: 640,
  menu: 360,
  inspect: 600,
});
function chatBounds(surface, area) {
  if (typeof surface !== "string" || !Object.hasOwn(heights, surface))
    throw new Error("Invalid chat surface");
  const width = Math.max(
    1,
    Math.min(surface === "settings" ? 600 : 760, area.width - 32),
  );
  const height = Math.max(1, Math.min(heights[surface], area.height - 32));
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  };
}
function fitChatBounds(bounds, area) {
  if (
    !bounds ||
    !["x", "y", "width", "height"].every(
      (key) => Number.isFinite(bounds[key]) && Math.abs(bounds[key]) <= 100000,
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return chatBounds("compact", area);
  const width = Math.min(area.width, Math.max(280, Math.round(bounds.width)));
  const height = Math.min(area.height, Math.max(64, Math.round(bounds.height)));
  return {
    width,
    height,
    x: Math.max(
      area.x,
      Math.min(Math.round(bounds.x), area.x + area.width - width),
    ),
    y: Math.max(
      area.y,
      Math.min(Math.round(bounds.y), area.y + area.height - height),
    ),
  };
}
// Apply only on initial restore, never during a native resize. Legacy files have
// no provenance; only the exact old default dimensions are eligible.
function restoreChatBounds(bounds, area) {
  if (bounds?.width === 680 && bounds?.height === 96)
    bounds = { ...bounds, height: 64 };
  return fitChatBounds(bounds, area);
}
// A response grows above the command bar, never recenters or shrinks a manual
// window. Legacy setup surfaces remain geometry-neutral. Only main picks sizes.
function expandChatBounds(surface, bounds, area) {
  chatBounds(surface, area); // finite semantic validation, before mutation
  const fitted = fitChatBounds(bounds, area);
  const required =
    surface === "review"
      ? 560
      : surface === "conversation"
        ? 280
        : surface === "notice"
          ? 144
          : 64;
  const height = Math.min(area.height, Math.max(fitted.height, required));
  if (height === fitted.height) return fitted;
  return {
    ...fitted,
    height,
    y: Math.max(area.y, fitted.y + fitted.height - height),
  };
}
module.exports = {
  chatBounds,
  fitChatBounds,
  restoreChatBounds,
  expandChatBounds,
};
