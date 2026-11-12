const DRAG_THRESHOLD_PX = 5;
let suppressNextClick = false;

function wireBubble(button, onToggle) {
  let gesture = null;

  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    button.setPointerCapture(e.pointerId);
    gesture = { id: e.pointerId, x: e.screenX, y: e.screenY, moved: false };
    window.api.dragStart();
  });

  button.addEventListener('pointermove', (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.screenX - gesture.x;
    const dy = e.screenY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    gesture.moved = true;
    button.classList.add('is-dragging');
    window.api.dragMove(dx, dy);
  });

  const finish = (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const { moved } = gesture;
    gesture = null;
    button.classList.remove('is-dragging');
    window.api.dragEnd(moved);
    if (moved) suppressNextClick = true;
  };
  button.addEventListener('pointerup', finish);
  button.addEventListener('pointercancel', finish);

  button.addEventListener('click', () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    onToggle();
  });
}

export { wireBubble };
