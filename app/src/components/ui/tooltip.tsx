import type { ReactNode } from 'react';

export type Tooltip = {
  /** Shows the tooltip for the element that raised the event, after a hover delay unless `immediate`. */
  show: (event: unknown, immediate?: boolean) => void;
  hide: () => void;
  tooltip: ReactNode;
};

/** Hover tooltips exist only on web (`tooltip.web.tsx`); native keeps its accessibility labels. */
export function useTooltip(_label: string): Tooltip {
  return { show: () => {}, hide: () => {}, tooltip: null };
}
