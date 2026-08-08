import type { GridCell, GridLayer, WeekStart } from "@mindforge/core";
import type { TFunction } from "i18next";
import { useEffect, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  formatDay,
  formatMinutes,
  formatMonth,
  formatPercent,
} from "../../../shared/lib/format.js";
import { Text } from "../../../shared/ui/index.js";
import { intensityOpacity, leadingOffset, monthMarkers, temperColour } from "../model/heatmap.js";
import "./activity-grid.css";

/**
 * A year of days, with GitHub's shape and deliberately not its semantics (FR-I6b, §3.9).
 *
 * GitHub encodes one thing — volume — and darker is better. Here a cell carries two channels:
 * **opacity is the layer's own value** and **hue is the day's ember share**, so a heavy grey square
 * reads as "you spent a lot and got little" rather than as your best week.
 *
 * The rule that decides whether this screen tells the truth: **`emberShare: null` is not zero.** A
 * day with no logged friction is drawn hatched and hueless, never grey, because grey is one end of a
 * measured scale and an unannotated day was never measured. `buildGrid` already computed both
 * channels; this file renders them and recomputes nothing.
 */
interface ActivityHeatmapProps {
  readonly cells: readonly GridCell[];
  readonly layer: GridLayer;
  readonly weekStartsOn: WeekStart;
}

export function ActivityHeatmap({ cells, layer, weekStartsOn }: ActivityHeatmapProps) {
  const { t, i18n } = useTranslation("insights");
  const locale = i18n.language;
  const scroller = useRef<HTMLDivElement>(null);

  const last = cells.at(-1)?.day;

  useEffect(() => {
    // Opens on the most recent weeks. On a phone the container holds twelve of fifty-two, and
    // starting at the left would show the same fortnight last February to everyone forever.
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [last, layer]);

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
          const label = cellLabel(cell, layer, locale, t);

          return (
            <div
              key={cell.day}
              className="mf-heatmap__cell"
              data-empty={cell.intensity === 0 ? "true" : undefined}
              data-measured={measured(cell)}
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

/**
 * Three states, not two.
 *
 * `undefined` on an empty day — it has nothing to say about temper and the neutral square already
 * says so. `"false"` is the load-bearing one: work happened and nobody annotated it.
 */
function measured(cell: GridCell): "true" | "false" | undefined {
  if (cell.intensity === 0) return undefined;
  return cell.emberShare === null ? "false" : "true";
}

/**
 * The two channels, as inline declarations. Nothing else about a cell varies.
 *
 * The hue goes through a custom property rather than `background-color` so that the *absence* of a
 * hue is a real absence: `[data-measured="true"]` is the only rule that reads it, so a day with no
 * logged friction has no fill to inherit and cannot end up grey by accident.
 */
function cellStyle(cell: GridCell, offset: number | null): CSSProperties {
  return {
    // Only the first cell is placed; the rest flow down the column after it. This one declaration
    // is what aligns fifty-two weeks to the user's own first day of the week.
    ...(offset === null ? {} : { gridRowStart: offset + 1 }),
    ...(cell.intensity === 0 ? {} : { opacity: intensityOpacity(cell.intensity) }),
    ...(cell.intensity === 0 || cell.emberShare === null
      ? {}
      : { "--mf-cell-hue": temperColour(cell.emberShare) }),
  };
}

function cellLabel(
  cell: GridCell,
  layer: GridLayer,
  locale: string,
  t: TFunction<"insights">,
): string {
  const date = formatDay(cell.day, locale);
  const temper =
    cell.emberShare === null
      ? t("grid.temper.unmeasured")
      : t("grid.temper.measured", { percent: formatPercent(cell.emberShare, locale) });

  if (layer === "focus") {
    return cell.value === 0
      ? t("grid.cell.noFocus", { date, temper })
      : t("grid.cell.focus", { date, duration: formatMinutes(cell.value, locale), temper });
  }

  return cell.value === 0
    ? t("grid.cell.noNotes", { date, temper })
    : t("grid.cell.notes", { date, count: cell.value, temper });
}

/**
 * What the two channels mean, drawn in the same treatments the cells use.
 *
 * Not optional decoration: a two-channel encoding nobody explains is read as GitHub's one-channel
 * one, and then a dark slag week looks like a good week — which is the exact misreading §3.9 exists
 * to prevent.
 */
export function HeatmapLegend({ layer }: { readonly layer: GridLayer }) {
  const { t } = useTranslation("insights");

  return (
    <div className="mf-heatmap-legend">
      <Text as="span" tone="muted">
        <span className="mf-heatmap-key" data-key="ember" aria-hidden="true" /> {t("legend.ember")}
      </Text>
      <Text as="span" tone="muted">
        <span className="mf-heatmap-key" data-key="slag" aria-hidden="true" /> {t("legend.slag")}
      </Text>
      <Text as="span" tone="muted">
        <span className="mf-heatmap-key" data-key="unmeasured" aria-hidden="true" />{" "}
        {t("legend.unmeasured")}
      </Text>
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
        {/* The unit is the layer's own. On the notes layer "deeper is more time" would be a
            straightforwardly false reading of the same squares. */}
        {t(`legend.intensity.${layer}`)}
      </Text>
    </div>
  );
}
