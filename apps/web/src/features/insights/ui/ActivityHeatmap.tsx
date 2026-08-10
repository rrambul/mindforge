import type { GridCell, WeekStart } from "@mindforge/core";
import type { TFunction } from "i18next";
import { useEffect, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { formatDay, formatMinutes, formatMonth } from "../../../shared/lib/format.js";
import { Text } from "../../../shared/ui/index.js";
import { intensityOpacity, leadingOffset, monthMarkers } from "../model/heatmap.js";
import "./activity-grid.css";

/**
 * A year of days — the frequency tracker (FR-Q1).
 *
 * GitHub's shape with one deliberate refusal: no streak counter. Opacity is focus minutes,
 * bucketed by `buildGrid` into quartiles of your own history; this file renders that channel and
 * recomputes nothing.
 */
interface ActivityHeatmapProps {
  readonly cells: readonly GridCell[];
  readonly weekStartsOn: WeekStart;
}

export function ActivityHeatmap({ cells, weekStartsOn }: ActivityHeatmapProps) {
  const { t, i18n } = useTranslation("insights");
  const locale = i18n.language;
  const scroller = useRef<HTMLDivElement>(null);

  const last = cells.at(-1)?.day;

  useEffect(() => {
    // Opens on the most recent weeks. On a phone the container holds twelve of fifty-two, and
    // starting at the left would show the same fortnight last February to everyone forever.
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [last]);

  if (cells.length === 0) return null;

  const offset = leadingOffset(cells[0]!.day, weekStartsOn);

  return (
    <div
      ref={scroller}
      className="mf-heatmap-scroll"
      // Focusable because it scrolls: a region a mouse can pan and a keyboard cannot reach is half
      // a control. `group` is what gives the label somewhere to live.
      role="group"
      tabIndex={0}
      aria-label={t("grid.scrollLabel")}
    >
      {/* The dates live on the cells themselves, so the axis is decoration to a screen reader. */}
      <div className="mf-heatmap__months" aria-hidden="true">
        {monthMarkers(cells, weekStartsOn).map((marker) => (
          <span
            key={marker.day}
            className="mf-heatmap__month"
            style={{ gridColumnStart: marker.column }}
          >
            {formatMonth(marker.day, locale)}
          </span>
        ))}
      </div>

      <div className="mf-heatmap">
        {cells.map((cell, index) => {
          // Built once and used twice. A year is 365 of these, and the sentence a pointer reveals
          // has to be the one a screen reader announces or the two disagree about the same square.
          const label = cellLabel(cell, locale, t);

          return (
            <div
              key={cell.day}
              className="mf-heatmap__cell"
              data-empty={cell.intensity === 0 ? "true" : undefined}
              // Each square is its own labelled thing rather than the grid being one image: the
              // interesting question a reader asks a heatmap is about one day.
              role="img"
              aria-label={label}
              title={label}
              style={cellStyle(cell, index === 0 ? offset : null)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** The one channel, as an inline declaration. Nothing else about a cell varies. */
function cellStyle(cell: GridCell, offset: number | null): CSSProperties {
  return {
    // Only the first cell is placed; the rest flow down the column after it. This one declaration
    // is what aligns fifty-two weeks to the user's own first day of the week.
    ...(offset === null ? {} : { gridRowStart: offset + 1 }),
    ...(cell.intensity === 0 ? {} : { opacity: intensityOpacity(cell.intensity) }),
  };
}

function cellLabel(cell: GridCell, locale: string, t: TFunction<"insights">): string {
  const date = formatDay(cell.day, locale);

  return cell.value === 0
    ? t("grid.cell.noFocus", { date })
    : t("grid.cell.focus", { date, duration: formatMinutes(cell.value, locale) });
}

/**
 * What the channel means, drawn in the same treatments the cells use.
 */
export function HeatmapLegend() {
  const { t } = useTranslation("insights");

  return (
    <div className="mf-heatmap-legend">
      <Text as="span" tone="muted">
        <span className="mf-heatmap-key" data-key="empty" aria-hidden="true" /> {t("legend.empty")}
      </Text>
      <Text as="span" tone="muted">
        <span className="mf-heatmap-ramp" aria-hidden="true">
          <span style={{ opacity: intensityOpacity(1) }} />
          <span style={{ opacity: intensityOpacity(2) }} />
          <span style={{ opacity: intensityOpacity(3) }} />
          <span style={{ opacity: intensityOpacity(4) }} />
        </span>{" "}
        {t("legend.intensity.focus")}
      </Text>
    </div>
  );
}
