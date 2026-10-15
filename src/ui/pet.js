const mascot = document.getElementById("open-chat");
let drag,
  suppressClick = false;
mascot.onclick = () => {
  if (!suppressClick) window.adactive?.show();
};
mascot.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  suppressClick = false;
  drag = {
    id: event.pointerId,
    x: event.screenX,
    y: event.screenY,
    left: window.screenX,
    top: window.screenY,
  };
  mascot.setPointerCapture(event.pointerId);
});
mascot.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.screenX - drag.x,
    dy = event.screenY - drag.y;
  if (!suppressClick && Math.hypot(dx, dy) < 5) return;
  suppressClick = true;
  window.adactive
    ?.movePet({ x: drag.left + dx, y: drag.top + dy })
    .catch(() => {
      document.getElementById("pet-error").textContent = "ההזזה נכשלה";
    });
});
function endDrag() {
  drag = null;
}
mascot.addEventListener("pointerup", endDrag);
mascot.addEventListener("pointercancel", endDrag);
mascot.addEventListener("lostpointercapture", endDrag);
// Keyboard activation must not inherit a previous mouse drag.
mascot.addEventListener("keydown", () => {
  suppressClick = false;
});
mascot.addEventListener("dragstart", (event) => event.preventDefault());
document.getElementById("hide-pet").onclick = () => window.adactive?.hidePet();
function updateControls() {
  document.getElementById("pet-smaller").disabled = innerWidth <= 110;
  document.getElementById("pet-larger").disabled = innerWidth >= 260;
}
async function resizePet(width) {
  try {
    await window.adactive?.resizePet(width);
    updateControls();
  } catch {
    document.getElementById("pet-error").textContent = "שינוי הגודל נכשל";
  }
}
document.getElementById("pet-smaller").onclick = () =>
  resizePet(innerWidth - 20);
document.getElementById("pet-larger").onclick = () =>
  resizePet(innerWidth + 20);
document.getElementById("pet-reset").onclick = () => resizePet(130);
window.addEventListener("resize", updateControls);
updateControls();
