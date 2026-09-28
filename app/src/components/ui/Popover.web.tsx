import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';
import { usePointerLayout } from './pointer-layout';
import { View } from './tw';
import type { PopoverProps } from './Popover';
import { popoverRoleProps, SheetContent } from './popover-role';

export type { PopoverProps } from './Popover';

const GAP = 6;
const VIEWPORT_MARGIN = 8;
const MAX_HEIGHT = 360;
const MAX_WIDTH = 360;
const ITEM_SELECTOR =
  '[role="menuitem"]:not([aria-disabled="true"]), [role="option"]:not([aria-disabled="true"])';
const FOCUSABLE_SELECTOR =
  'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';

type Placement = {
  left: number;
  minWidth: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

/**
 * Web presentation of `Popover`: anchored under (or above) its trigger on
 * windows at least 600px wide, and the same bottom sheet as native below that.
 */
export function Popover(props: PopoverProps) {
  const anchored = usePointerLayout();

  if (!anchored) {
    return (
      <Dialog sheet visible={props.visible} title={props.label} onClose={props.onClose}>
        <SheetContent role={props.role ?? 'menu'} label={props.label}>
          {props.children}
        </SheetContent>
      </Dialog>
    );
  }

  if (!props.visible) return null;
  return <AnchoredPopover {...props} />;
}

function AnchoredPopover({
  onClose,
  anchorRef,
  label,
  role = 'menu',
  align = 'start',
  minWidth = 0,
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closedByOutsidePointer = useRef(false);
  const [placement, setPlacement] = useState<Placement>();
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Inside a dialog, the popover must render within the modal's own subtree:
  // the modal's focus trap otherwise pulls focus straight back out of it.
  useLayoutEffect(() => {
    // The target depends on where the anchor sits in the DOM, known only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalTarget(outermostModal(anchorElement(anchorRef)) ?? document.body);
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!portalTarget) return;

    function place() {
      const anchor = anchorElement(anchorRef);
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      setPlacement(computePlacement(anchor.getBoundingClientRect(), panel, align, minWidth));
    }

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [portalTarget, anchorRef, align, minWidth]);

  useEffect(() => {
    if (!placement || !panelRef.current) return;
    if (panelRef.current.contains(document.activeElement)) return;
    initialFocusTarget(panelRef.current, role)?.focus();
  }, [placement, role]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      // The trigger toggles the popover itself.
      if (anchorElement(anchorRef)?.contains(target)) return;
      closedByOutsidePointer.current = true;
      onCloseRef.current();
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [anchorRef]);

  // Return focus to the trigger when the popover closes from inside
  // (a choice, Escape, Tab) rather than by clicking somewhere else.
  useEffect(() => {
    const panel = panelRef;
    const outside = closedByOutsidePointer;
    return () => {
      if (outside.current) return;
      const active = document.activeElement;
      if (active && active !== document.body && !panel.current?.contains(active)) return;
      focusableIn(anchorElement(anchorRef))?.focus();
    };
  }, [anchorRef]);

  function handleKeyDown(event: ReactKeyboardEvent) {
    const panel = panelRef.current;
    if (!panel) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      swallowNextEscapeKeyUp();
      onClose();
      return;
    }
    // Menus and listboxes are one Tab stop; a dialog popover's controls are tabbable.
    if (event.key === 'Tab' && role !== 'dialog') {
      event.preventDefault();
      onClose();
      return;
    }

    const items = [...panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextItemIndex(event.key, current, items);

    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
      return;
    }
    // RN Web presses non-button roles on Enter but not on Space.
    if (event.key === ' ' && current >= 0) {
      event.preventDefault();
      items[current].click();
    }
  }

  function handleBlur(event: ReactFocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (!next || panelRef.current?.contains(next)) return;
    if (anchorElement(anchorRef)?.contains(next)) return;
    onClose();
  }

  const content = (
    <div
      ref={panelRef}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        position: 'fixed',
        zIndex: 1000,
        left: placement?.left ?? 0,
        top: placement?.top,
        bottom: placement?.bottom,
        minWidth: placement?.minWidth,
        maxWidth: MAX_WIDTH,
        maxHeight: placement?.maxHeight ?? MAX_HEIGHT,
        visibility: placement ? 'visible' : 'hidden',
        display: 'flex',
      }}
    >
      <View
        {...popoverRoleProps(role)}
        aria-label={label}
        className="min-w-0 flex-1 gap-0.5 overflow-y-auto rounded-card border border-line bg-raised p-1.5 shadow-popover"
      >
        {children}
      </View>
    </div>
  );

  return portalTarget ? createPortal(content, portalTarget) : null;
}

function anchorElement(anchorRef: PopoverProps['anchorRef']): HTMLElement | null {
  return anchorRef.current as unknown as HTMLElement | null;
}

function outermostModal(element: Element | null): Element | null {
  let modal: Element | null = null;
  let current = element?.closest('[aria-modal="true"]') ?? null;
  while (current) {
    modal = current;
    current = current.parentElement?.closest('[aria-modal="true"]') ?? null;
  }
  return modal;
}

function focusableIn(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  if (element.matches(FOCUSABLE_SELECTOR)) return element;
  return element.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}

function initialFocusTarget(panel: HTMLElement, role: PopoverProps['role']): HTMLElement | null {
  if (role === 'dialog') return panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  return (
    panel.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
    panel.querySelector<HTMLElement>(ITEM_SELECTOR)
  );
}

function computePlacement(
  anchor: DOMRect,
  panel: HTMLElement,
  align: 'start' | 'end',
  minWidth: number,
): Placement {
  const width = Math.min(MAX_WIDTH, Math.max(minWidth, anchor.width, panel.offsetWidth));
  const spaceBelow = window.innerHeight - anchor.bottom - GAP - VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - GAP - VIEWPORT_MARGIN;
  const openAbove = panel.scrollHeight > spaceBelow && spaceAbove > spaceBelow;

  const preferredLeft = align === 'end' ? anchor.right - width : anchor.left;
  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, maxLeft));

  return {
    left,
    minWidth: Math.max(minWidth, anchor.width),
    maxHeight: Math.min(MAX_HEIGHT, openAbove ? spaceAbove : spaceBelow),
    top: openAbove ? undefined : anchor.bottom + GAP,
    bottom: openAbove ? window.innerHeight - anchor.top + GAP : undefined,
  };
}

function nextItemIndex(key: string, current: number, items: HTMLElement[]): number | undefined {
  const last = items.length - 1;
  if (key === 'ArrowDown') return current < 0 || current === last ? 0 : current + 1;
  if (key === 'ArrowUp') return current <= 0 ? last : current - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (key.length !== 1 || key === ' ') return undefined;

  // Type-ahead: jump to the next item starting with the typed character.
  const letter = key.toLowerCase();
  for (let step = 1; step <= items.length; step++) {
    const index = (current + step) % items.length;
    const text = items[index].textContent?.trim().toLowerCase() ?? '';
    if (text.startsWith(letter)) return index;
  }
  return undefined;
}

/**
 * RN Web's Modal closes itself on the Escape *keyup*. When Escape closes a
 * popover opened inside a dialog, that same key release must not also close
 * the dialog underneath it.
 */
function swallowNextEscapeKeyUp() {
  function swallow(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    window.removeEventListener('keyup', swallow, true);
  }
  window.addEventListener('keyup', swallow, true);
}
