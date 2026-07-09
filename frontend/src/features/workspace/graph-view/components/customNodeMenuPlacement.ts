/**
 * Approximate rendered height (px) of the settings dropdown: five fixed rows
 * (Rename / Clone / Undo / Redo / Delete) plus borders and the trigger gap.
 */
const NODE_MENU_ESTIMATED_HEIGHT_PX = 180;

/**
 * Approximate rendered width (px) of the settings dropdown. Matches the menu's
 * ``min-w-36`` (9rem) floor.
 */
const NODE_MENU_ESTIMATED_WIDTH_PX = 144;

/** Corner the settings dropdown should expand from, per axis. */
export interface NodeMenuPlacement {
  /** true -> expand upward (`bottom-9`); false -> downward (`top-9`). */
  opensUp: boolean;
  /** true -> extend right (`left-0`); false -> extend left (`right-0`). */
  opensRight: boolean;
}

/**
 * Decides which corner the settings dropdown should expand from so it stays
 * inside the graph viewport instead of being clipped at an edge.
 *
 * Called by: CustomNodeActionMenu when the settings button opens the menu.
 * Flow: measure the trigger button, find the enclosing `.react-flow` pane,
 * then flip vertically or horizontally only when the default side cannot fit
 * and the opposite side has more room. Falls back to the window when no pane is
 * found.
 */
export function computeMenuPlacement(trigger: HTMLElement): NodeMenuPlacement {
  const buttonRect = trigger.getBoundingClientRect();
  const paneRect = trigger.closest('.react-flow')?.getBoundingClientRect();
  const topLimit = paneRect ? paneRect.top : 0;
  const bottomLimit = paneRect ? paneRect.bottom : window.innerHeight;
  const leftLimit = paneRect ? paneRect.left : 0;
  const rightLimit = paneRect ? paneRect.right : window.innerWidth;

  const spaceBelow = bottomLimit - buttonRect.bottom;
  const spaceAbove = buttonRect.top - topLimit;
  const spaceLeft = buttonRect.right - leftLimit;
  const spaceRight = rightLimit - buttonRect.left;

  return {
    opensUp: spaceBelow < NODE_MENU_ESTIMATED_HEIGHT_PX && spaceAbove > spaceBelow,
    opensRight: spaceLeft < NODE_MENU_ESTIMATED_WIDTH_PX && spaceRight > spaceLeft,
  };
}
