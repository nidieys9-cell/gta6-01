// input.js — keyboard and mouse state for the game loop. The loop reads a
// per-frame frame-input built from this raw state (see main.js): held keys, the
// mouse position over the canvas, and edge-triggered presses.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0, down: false, clicked: false };
  let menuTarget = null; // set by render: clickable menu items for the title screen

  function onKeyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
  }
  function onMouseDown(e) {
    mouse.down = true;
    mouse.clicked = true;
    onMouseMove(e);
    if (menuTarget) menuTarget(mouse.x, mouse.y);
  }
  function onMouseUp() { mouse.down = false; }
  function onBlur() { keys.clear(); mouse.down = false; }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
  }

  return {
    keys,
    mouse,
    /** Edge-triggered: true once per physical press. Cleared by endFrame(). */
    wasPressed(code) { return pressed.has(code); },
    endFrame() { pressed.clear(); mouse.clicked = false; },
    setMenuTarget(fn) { menuTarget = fn; },
    axis() {
      const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const y = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      return { x, y };
    },
  };
}
