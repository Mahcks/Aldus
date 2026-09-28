import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Text } from './tw';
import type { Tooltip } from './tooltip';

const HOVER_DELAY_MS = 500;
const GAP = 6;
const VIEWPORT_MARGIN = 8;

type Placement = { left: number; top: number };

/**
 * Names an icon-only control on hover or keyboard focus. The control's
 * accessibility label already carries the same text, so the tooltip itself
 * is hidden from assistive tech.
 */
export function useTooltip(label: string): Tooltip {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<Placement>();
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!target || !tipRef.current) return;
    setPlacement(computePlacement(target.getBoundingClientRect(), tipRef.current));
  }, [target]);

  function show(event: unknown, immediate = false) {
    const element = controlFromEvent(event);
    if (!element) return;
    clearTimeout(timer.current);
    if (immediate) {
      setTarget(element);
      return;
    }
    timer.current = setTimeout(() => setTarget(element), HOVER_DELAY_MS);
  }

  function hide() {
    clearTimeout(timer.current);
    setTarget(null);
    setPlacement(undefined);
  }

  const tooltip = target
    ? createPortal(
        <div
          ref={tipRef}
          aria-hidden
          style={{
            position: 'fixed',
            // Above RN Web's modal layer (9999), so icon buttons in dialogs get tooltips too.
            zIndex: 10050,
            left: placement?.left ?? 0,
            top: placement?.top ?? 0,
            visibility: placement ? 'visible' : 'hidden',
            pointerEvents: 'none',
          }}
        >
          <Text className="rounded-control bg-ink px-2.5 py-1.5 text-xs font-sans-semibold text-canvas">
            {label}
          </Text>
        </div>,
        document.body,
      )
    : null;

  return { show, hide, tooltip };
}

function controlFromEvent(event: unknown): HTMLElement | null {
  const native = (event as { nativeEvent?: Event; target?: EventTarget } | undefined) ?? {};
  const origin = (native.nativeEvent?.target ?? native.target) as Element | null | undefined;
  return origin?.closest?.<HTMLElement>('[role="button"], button, a') ?? null;
}

function computePlacement(control: DOMRect, tip: HTMLElement): Placement {
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const centeredLeft = control.left + control.width / 2 - width / 2;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(centeredLeft, window.innerWidth - VIEWPORT_MARGIN - width),
  );
  const above = control.top - GAP - height >= VIEWPORT_MARGIN;
  const top = above ? control.top - GAP - height : control.bottom + GAP;
  return { left, top };
}
