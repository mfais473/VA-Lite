const COLLAPSED = { width: 96, height: 96 };
const EXPANDED = { width: 420, height: 660 };
const EDGE_MARGIN = 24;

const clamp = (n, min, max) => Math.min(Math.max(n, min), Math.max(min, max));

function layoutFor(bounds, workArea, expanded, current) {
  let next = current;
  if (expanded) {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    next = {
      h: cx >= workArea.x + workArea.width / 2 ? 'right' : 'left',
      v: cy >= workArea.y + workArea.height / 2 ? 'bottom' : 'top',
    };
  }
  const target = expanded ? EXPANDED : COLLAPSED;
  const width = Math.min(target.width, workArea.width);
  const height = Math.min(target.height, workArea.height);
  const anchorX = next.h === 'right' ? bounds.x + bounds.width : bounds.x;
  const anchorY = next.v === 'bottom' ? bounds.y + bounds.height : bounds.y;
  const x = clamp(next.h === 'right' ? anchorX - width : anchorX, workArea.x, workArea.x + workArea.width - width);
  const y = clamp(next.v === 'bottom' ? anchorY - height : anchorY, workArea.y, workArea.y + workArea.height - height);
  return {
    bounds: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) },
    placement: next,
  };
}

module.exports = { COLLAPSED, EXPANDED, EDGE_MARGIN, clamp, layoutFor };
