/**
 * Keyboard + ARIA wiring for the shared selection treatment (D-022).
 * Visuals live in globals.css (`[aria-pressed]`, `[aria-selected]`, `[aria-current]`, `.is-selected`).
 */
import type { KeyboardEvent } from "react";
import { isActivationKey, nextTabIndex } from "@/lib/ui/selection";

/**
 * Tablist roving focus: arrows/Home/End move focus to the next `[role=tab]` and
 * activate it (selection follows focus).
 */
export function onTablistKeyDown(e: KeyboardEvent<HTMLElement>) {
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]"));
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const n = nextTabIndex(i, e.key, tabs.length);
  if (n == null) return;
  e.preventDefault();
  tabs[n]?.focus();
  tabs[n]?.click();
}

/** Props for a tab button inside `role=tablist`. */
export function tabProps(selected: boolean, onSelect: () => void) {
  return {
    role: "tab" as const,
    "aria-selected": selected,
    tabIndex: selected ? 0 : -1,
    onClick: onSelect,
  };
}

/**
 * Props for a selectable table row (table must be `role="grid"`) — click or
 * Enter/Space toggles; clicks on links/buttons inside the row still navigate.
 */
export function selectableRowProps(selected: boolean, onToggle: () => void) {
  return {
    "aria-selected": selected,
    tabIndex: 0,
    className: `row-selectable${selected ? " is-selected" : ""}`,
    onClick: (e: { target: EventTarget | null }) => {
      if ((e.target as HTMLElement | null)?.closest?.("a,button,input,select")) return;
      onToggle();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || !isActivationKey(e.key)) return;
      e.preventDefault();
      onToggle();
    },
  };
}
