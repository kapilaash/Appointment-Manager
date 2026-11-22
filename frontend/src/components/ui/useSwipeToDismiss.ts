import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';

const DISMISS_DISTANCE = 96; // px dragged down before letting go closes the sheet

/**
 * Drag-down-to-close for bottom sheets. Attach the returned handlers to a grab handle so
 * scrolling and form fields inside the sheet keep working normally; buttons stay available
 * for keyboard and screen-reader users.
 */
export function useSwipeToDismiss(onDismiss: () => void, enabled = true) {
  const startY = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);

  const end = () => {
    if (startY.current !== null && offset > DISMISS_DISTANCE) onDismiss();
    startY.current = null;
    setOffset(0);
  };

  const handleProps = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!enabled) return;
      startY.current = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (startY.current === null) return;
      setOffset(Math.max(0, event.clientY - startY.current));
    },
    onPointerUp: end,
    onPointerCancel: end,
    style: { touchAction: 'none' } satisfies CSSProperties,
  };

  // Follow the finger while dragging; snap back smoothly when released.
  const sheetStyle: CSSProperties = offset
    ? { transform: `translate3d(0, ${offset}px, 0)`, transition: 'none' }
    : { transition: 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)' };

  return { handleProps, sheetStyle, dragging: offset > 0 };
}
