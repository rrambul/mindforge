import { useEffect, useMemo, useState } from "react";
import { matchActions, type Action } from "../lib/action-registry.js";
import { Field } from "./Field.js";
import { VisuallyHidden } from "./VisuallyHidden.js";
import "./styles/command.css";

interface CommandSurfaceProps {
  readonly actions: readonly Action[];
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Already translated: the input's label, the empty message, and the dialog's name. */
  readonly labels: {
    readonly title: string;
    readonly search: string;
    readonly empty: string;
  };
}

/**
 * The command palette on desktop and the action sheet on mobile — one component (§5.1).
 *
 * They are the same thing because they are the same list of actions; only the position differs, and
 * position is a stylesheet's job. Two components would be two places for an action to go missing, and
 * the one it went missing from would be mobile.
 *
 * Dumb by design: it is handed actions and told whether it is open. What the actions *do* is wired in
 * the app layer, which is the only layer allowed to know about more than one feature.
 */
export function CommandSurface({ actions, isOpen, onClose, labels }: CommandSurfaceProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const matches = useMemo(() => matchActions(actions, query), [actions, query]);

  // Reset on open rather than on close: leaving the previous query in place means the next ⌘K shows a
  // filtered list for something the user has stopped thinking about.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelected(0);
    }
  }, [isOpen]);

  // Clamped rather than reset, so typing one more character does not throw away the selection when the
  // list merely got shorter.
  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  if (!isOpen) return null;

  const runnable = matches.filter((action) => action.unavailableReason === undefined);

  function move(delta: number): void {
    if (matches.length === 0) return;
    // Wraps, because a list this short is faster to cycle than to reverse direction in.
    setSelected((current) => (current + delta + matches.length) % matches.length);
  }

  function runSelected(): void {
    const action = matches[selected];
    // An unavailable action does nothing rather than closing the surface: closing would look like it
    // ran, which on "Stop focus" with nothing running is a genuinely confusing lie.
    if (!action || action.unavailableReason !== undefined) return;
    onClose();
    action.run();
  }

  return (
    <div
      className="mf-command-backdrop"
      // Clicking away closes it. Only on the backdrop itself, so a click inside that happens to end on
      // the backdrop's padding does not dismiss what you were reading.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="mf-command"
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            runSelected();
          }
        }}
      >
        <Field
          label={labels.search}
          // Autofocused rather than focused through a ref: the surface unmounts when closed, so it
          // mounts fresh on every open and this is the whole of the behaviour. A palette you have to
          // click into is a palette that costs more than the button it replaced.
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          // The palette is a search box; the browser's own suggestions would cover the list.
          role="combobox"
          aria-expanded
          aria-controls="mf-command-list"
          aria-activedescendant={
            matches[selected] ? `mf-command-${matches[selected].id}` : undefined
          }
        />

        {/* Announced, because the count changing as you type is the only feedback that filtering
            works — and it is invisible to a screen reader otherwise. */}
        <VisuallyHidden>
          <span role="status">{`${runnable.length}`}</span>
        </VisuallyHidden>

        {matches.length === 0 ? (
          <p className="mf-text" data-tone="muted">
            {labels.empty}
          </p>
        ) : (
          <ul className="mf-command__list" id="mf-command-list" role="listbox">
            {matches.map((action, index) => (
              <Item
                key={action.id}
                action={action}
                selected={index === selected}
                previousGroup={matches[index - 1]?.group}
                onHover={() => setSelected(index)}
                onRun={() => {
                  onClose();
                  action.run();
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Item({
  action,
  selected,
  previousGroup,
  onHover,
  onRun,
}: {
  readonly action: Action;
  readonly selected: boolean;
  readonly previousGroup: string | undefined;
  readonly onHover: () => void;
  readonly onRun: () => void;
}) {
  const unavailable = action.unavailableReason !== undefined;

  return (
    <>
      {/* A heading only when the group changes, so a list of one group has no chrome. */}
      {action.group === previousGroup ? null : (
        <li className="mf-command__group" role="presentation">
          {action.group}
        </li>
      )}
      <li role="none">
        <button
          type="button"
          id={`mf-command-${action.id}`}
          className="mf-command__item"
          role="option"
          aria-selected={selected}
          disabled={unavailable}
          onMouseEnter={onHover}
          onClick={onRun}
        >
          <span>{action.label}</span>
          {/* The reason is shown rather than the action being hidden — see `unavailableReason`. */}
          {unavailable ? (
            <span className="mf-command__reason">{action.unavailableReason}</span>
          ) : null}
        </button>
      </li>
    </>
  );
}
