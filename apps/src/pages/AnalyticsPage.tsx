import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLibraryStore } from "../store/libraryStore";
import { useHabitStore, buildDateRange, getDateKey, isGoalMet } from "../store/habitStore";

const minutesLabel = (minutes: number) => `${Math.round(minutes)}m`;

const palette = ["#d9886e", "#4f9d8c", "#8a78c9", "#d0a44f", "#5d8d59", "#4f7fb7", "#c86a8a", "#c07d4c"];
const iconSet = ["pets", "local_florist", "nightlight", "auto_awesome", "coffee", "forest", "menu_book", "favorite"];
const spikeSet = ["zig", "steps", "teeth"] as const;
const stickerShapes = ["circle", "diamond", "ticket", "squircle"] as const;
const stripeCounts = [1, 2, 3] as const;
const cornerStyles = ["round", "sharp", "chamfer"] as const;
const foilTypes = ["none", "gold", "silver", "bronze"] as const;

const hashSeed = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const darkenHex = (hex: string, amount: number) => {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return hex;
  }
  const num = Number.parseInt(normalized, 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
};

const pick = <T,>(items: T[], seed: number) => items[seed % items.length];

const buildIconStyle = (seed: number, width: number, height: number) => {
  const iconSizes = [16, 18, 20, 22, 24];
  const rotation = (seed % 9) * 4 - 16;
  const paddingX = 8;
  const paddingY = 10;
  const maxLeft = Math.max(paddingX, width - paddingX - 20);
  const maxTop = Math.max(paddingY, height - paddingY - 20);
  const left = paddingX + (seed % 13) * ((maxLeft - paddingX) / 12);
  const top = paddingY + ((seed >> 2) % 11) * ((maxTop - paddingY) / 10);
  const stickerSize = pick([18, 20, 22, 24], seed + 3);
  return {
    fontSize: pick(iconSizes, seed),
    width: `${stickerSize}px`,
    height: `${Math.round(stickerSize * 0.9)}px`,
    ["--sticker-rot" as string]: `${rotation}deg`,
    left: `${left}px`,
    top: `${top}px`
  } as CSSProperties;
};

const buildStainStyle = (seed: number, width: number, height: number) => {
  const sizes = [10, 12, 14, 16, 18];
  const size = pick(sizes, seed);
  const left = 6 + (seed % 11) * Math.max(1, (width - 24) / 10);
  const top = 10 + ((seed >> 3) % 11) * Math.max(1, (height - 30) / 10);
  const rotation = (seed % 12) * 7;
  return {
    width: `${size}px`,
    height: `${size}px`,
    left: `${left}px`,
    top: `${top}px`,
    transform: `rotate(${rotation}deg)`
  };
};

const useCountUp = (target: number) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
};

export const AnalyticsPage = () => {
  const { books } = useLibraryStore();
  const { goal, sessions, daily } = useHabitStore();
  const completedSessions = useMemo(
    () => sessions.filter((session) => session.endedReason === "completed"),
    [sessions]
  );
  const demoSessions = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() - 24);
    const titles = [
      "Quiet Mornings",
      "Leaf and Lantern",
      "Soft Rain",
      "Gold Hour",
      "Moss and Ink",
      "Slow Bloom"
    ];
    return Array.from({ length: 18 }).map((_, index) => {
      const minutes = 12 + (index % 5) * 6 + (index % 3) * 4;
      const started = new Date(base.getTime() + index * 1000 * 60 * 60 * 12);
      const ended = new Date(started.getTime() + minutes * 60000);
      const accent = palette[index % palette.length];
      const icon = iconSet[index % iconSet.length];
      const spike = spikeSet[index % spikeSet.length];
      const stickerShape = stickerShapes[index % stickerShapes.length];
      const stripeCount = stripeCounts[index % stripeCounts.length];
      const cornerStyle = cornerStyles[index % cornerStyles.length];
      const foil = foilTypes[index % foilTypes.length];
      const showSticker = index % 5 !== 0;
      const showStripes = index % 4 !== 0;
      const showFoil = index % 6 === 0;
      const showWear = index % 3 !== 0;
      return {
        id: `demo-${index}`,
        startedAt: started.toISOString(),
        endedAt: ended.toISOString(),
        durationMinutes: minutes,
        title: titles[index % titles.length],
        endedReason: "completed" as const,
        cleanSession: true,
        shelfStyle: {
          accent,
          icon,
          spike,
          stickerShape,
          stripeCount,
          cornerStyle,
          foil,
          wear: showWear ? 0.35 : 0,
          showSticker,
          showStripes,
          showFoil,
          showWear
        }
      };
    });
  }, []);
  const hasRealSessions = completedSessions.length > 0;
  const metricSessions = hasRealSessions ? completedSessions : demoSessions;
  const demoDaily = useMemo(() => {
    const map: Record<string, { minutes: number }> = {};
    for (const session of demoSessions) {
      const dateKey = getDateKey(new Date(session.startedAt));
      const record = map[dateKey] ?? { minutes: 0 };
      record.minutes += session.durationMinutes;
      map[dateKey] = record;
    }
    return map;
  }, [demoSessions]);
  const dailySource = hasRealSessions ? daily : demoDaily;

  const totalMinutes = useMemo(
    () => metricSessions.reduce((sum, session) => sum + session.durationMinutes, 0),
    [metricSessions]
  );
  const averageSession = metricSessions.length > 0 ? totalMinutes / metricSessions.length : 0;
  const finishedBooks = books.filter((book) => book.progress >= 1).length;
  const estimatedPages = Math.round(totalMinutes * 1);

  const longestStreak = useMemo(() => {
    const keys = buildDateRange(365);
    let best = 0;
    let current = 0;
    for (const key of keys) {
      if (isGoalMet(goal, dailySource[key])) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
    }
    return best;
  }, [goal, dailySource]);

  const last30Keys = useMemo(() => buildDateRange(30), []);
  const consistencyScore = useMemo(() => {
    const met = last30Keys.filter((key) => isGoalMet(goal, dailySource[key])).length;
    return Math.round((met / last30Keys.length) * 100);
  }, [goal, dailySource, last30Keys]);

  const monthlyChart = last30Keys.map((key) => dailySource[key]?.minutes ?? 0);
  const weeklyKeys = useMemo(() => buildDateRange(7), []);

  const totalMinutesDisplay = useCountUp(totalMinutes);
  const avgSessionDisplay = useCountUp(averageSession);
  const finishedBooksDisplay = useCountUp(finishedBooks);
  const pagesDisplay = useCountUp(estimatedPages);
  const longestStreakDisplay = useCountUp(longestStreak);
  const consistencyDisplay = useCountUp(consistencyScore);

  const sortedSessions = useMemo(
    () =>
      [...metricSessions].sort(
        (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)
      ),
    [metricSessions]
  );

  const shelfLevels = [
    {
      name: "Wood",
      label: "Timber Shelf",
      background: "linear-gradient(180deg, #2f2418 0%, #3a2b1b 55%, #1d140d 100%)",
      line: "#4a361f",
      border: "rgba(255, 255, 255, 0.12)"
    },
    {
      name: "Stone",
      label: "Stone Shelf",
      background: "linear-gradient(180deg, #2f2f34 0%, #3a3a42 55%, #1e1e24 100%)",
      line: "#4b4c57",
      border: "rgba(255, 255, 255, 0.14)"
    },
    {
      name: "Copper",
      label: "Copper Shelf",
      background: "linear-gradient(180deg, #4a2c22 0%, #6a3e2d 55%, #2b1812 100%)",
      line: "#9a5a3e",
      border: "rgba(255, 210, 180, 0.28)"
    },
    {
      name: "Iron",
      label: "Iron Shelf",
      background: "linear-gradient(180deg, #3c4149 0%, #50565f 55%, #2b3037 100%)",
      line: "#7a828f",
      border: "rgba(210, 220, 230, 0.3)"
    },
    {
      name: "Gold",
      label: "Gold Shelf",
      background: "linear-gradient(180deg, #5a3f16 0%, #7a5520 55%, #33210b 100%)",
      line: "#b07a2d",
      border: "rgba(255, 220, 150, 0.4)"
    },
    {
      name: "Diamond",
      label: "Diamond Shelf",
      background: "linear-gradient(180deg, #15343a 0%, #1d4750 55%, #0d1f22 100%)",
      line: "#2d6a75",
      border: "rgba(120, 220, 230, 0.4)"
    },
    {
      name: "Netherite",
      label: "Netherite Shelf",
      background: "linear-gradient(180deg, #241927 0%, #3a2440 55%, #150f18 100%)",
      line: "#5a2f66",
      border: "rgba(200, 150, 255, 0.35)"
    }
  ];

  const capacityPerShelf = 50;
  const shelfLevelIndex = Math.min(
    shelfLevels.length - 1,
    Math.floor((hasRealSessions ? completedSessions.length : 0) / capacityPerShelf)
  );
  const shelfTheme = shelfLevels[shelfLevelIndex];
  const showTierPreview = false;

  return (
    <div className="flex min-h-full flex-col gap-10">
      <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {[
          { label: "Total Time", value: minutesLabel(totalMinutesDisplay) },
          { label: "Books Finished", value: finishedBooksDisplay },
          { label: "Pages Read", value: pagesDisplay },
          { label: "Average Session", value: minutesLabel(avgSessionDisplay) },
          { label: "Longest Streak", value: `${longestStreakDisplay} days` },
          { label: "Consistency", value: `${consistencyDisplay}%` }
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5 shadow-[0_18px_40px_rgba(0,0,0,0.18)]"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">{item.label}</p>
            <p className="mt-3 text-3xl font-headline font-bold text-on-surface">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-[32px] border border-outline-variant/20 bg-gradient-to-br from-surface-container-low via-surface to-surface-container-high p-6 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-on-surface-variant">Your Reading Shelf</p>
            <h2 className="mt-2 text-2xl font-headline font-bold text-on-surface">Session Bookshelf</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-outline-variant/40 bg-surface-container-high px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
              {shelfTheme.label}
            </span>
            <p className="text-xs text-on-surface-variant">
              {metricSessions.length} sessions / {minutesLabel(totalMinutes)}
              {!hasRealSessions && " / Sample data"}
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          <div
            className="rounded-[28px] border p-4 shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
            style={{
              borderColor: shelfTheme.border,
              background: shelfTheme.background
            }}
          >
            <div
              className="leaflet-shelf leaflet-session-shelf"
              style={
                {
                  ["--shelf-line" as string]: shelfTheme.line
                } as CSSProperties
              }
            >
            {sortedSessions.map((session, index) => {
                    const minutes = session.durationMinutes;
                    const seed = hashSeed(session.id);
                    const height = Math.min(150, Math.max(70, 54 + minutes * 2.2));
                    const widthJitter = (seed % 9) - 4;
                    const width = Math.round(Math.min(72, Math.max(30, 28 + Math.round(minutes * 0.9) + widthJitter * 2)));
                    const color = palette[index % palette.length];
                    const shelfStyle = session.shelfStyle ?? {
                      accent: color,
                      icon: iconSet[index % iconSet.length],
                      spike: spikeSet[index % spikeSet.length],
                      stickerShape: stickerShapes[index % stickerShapes.length],
                      stripeCount: stripeCounts[index % stripeCounts.length],
                      cornerStyle: cornerStyles[index % cornerStyles.length],
                      foil: foilTypes[index % foilTypes.length],
                      wear: 0.35,
                      showSticker: true,
                      showStripes: true,
                      showFoil: false,
                      showWear: true
                    };
                    const stainColor = darkenHex(color, 52);
                    const iconSeed = hashSeed(session.id);
                    const iconStyle = buildIconStyle(iconSeed, width, height);
                    const stainSeed = hashSeed(`${session.id}-stain`);
                    const stripeSeed = hashSeed(`${session.id}-stripe`);
                    const stripeOpacity = 0.22 + (stripeSeed % 20) / 100;
                    const foilColor =
                      shelfStyle.foil === "gold"
                        ? "rgba(255, 217, 120, 0.85)"
                        : shelfStyle.foil === "silver"
                          ? "rgba(210, 220, 230, 0.85)"
                          : shelfStyle.foil === "bronze"
                            ? "rgba(214, 150, 96, 0.85)"
                            : "transparent";
                    const cornerClass =
                      shelfStyle.cornerStyle === "chamfer"
                        ? "leaflet-book-chamfer"
                        : shelfStyle.cornerStyle === "sharp"
                          ? "leaflet-book-sharp"
                          : "leaflet-book-round";
                    const delay = index * 35;
                    const date = new Date(session.startedAt);
                    const streakCount = Math.round(minutes / Math.max(goal.target, 1));
                    const hasRibbon = hashSeed(session.id) % 5 === 0;
                    return (
                      <div key={session.id} className="leaflet-shelf-item relative flex items-end">
                        <div className="group relative flex items-end">
                          <div
                            className={`leaflet-book relative shadow-[0_18px_30px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out group-hover:-translate-y-2 ${cornerClass}`}
                            style={{
                              height: `${height}px`,
                              width: `${width}px`,
                              background: color,
                              animationDelay: `${delay}ms`
                            }}
                          >
                            <span
                              className={`leaflet-spike leaflet-spike-${shelfStyle.spike}`}
                              style={{ ["--spike-color" as string]: shelfStyle.accent } as CSSProperties}
                            />
                            {shelfStyle.showStripes &&
                              Array.from({ length: shelfStyle.stripeCount }).map((_, stripeIndex) => {
                                const offset = 6 + stripeIndex * 6 + (stripeSeed % 4);
                                return (
                                  <span
                                    key={`${session.id}-stripe-${stripeIndex}`}
                                    className="absolute top-2 h-[72%] rounded-full"
                                    style={{
                                      left: `${offset}px`,
                                      width: `${2 + ((stripeSeed + stripeIndex) % 2)}px`,
                                      background: `rgba(255, 255, 255, ${stripeOpacity})`
                                    }}
                                  />
                                );
                              })}
                            {shelfStyle.showFoil && shelfStyle.foil !== "none" && (
                              <span
                                className="leaflet-foil"
                                style={{
                                  background: `linear-gradient(135deg, ${foilColor}, rgba(255,255,255,0.2))`,
                                  top: `${12 + (stripeSeed % 18)}px`
                                }}
                              />
                            )}
                            {shelfStyle.showSticker && (
                              <span
                                className="leaflet-sticker"
                                data-shape={shelfStyle.stickerShape}
                                style={{ background: "#f9fafb", ...iconStyle } as CSSProperties}
                              >
                                <span className="material-symbols-outlined text-[12px] leading-none">
                                  {shelfStyle.icon}
                                </span>
                              </span>
                            )}
                            {shelfStyle.showWear && (
                              <>
                                <span
                                  className="leaflet-stain"
                                  style={{ background: stainColor, ...buildStainStyle(stainSeed, width, height) } as CSSProperties}
                                />
                                <span
                                  className="leaflet-stain"
                                  style={{ background: stainColor, ...buildStainStyle(stainSeed + 19, width, height) } as CSSProperties}
                                />
                                {hashSeed(`${session.id}-ink`) % 3 === 0 && (
                                  <span
                                    className="leaflet-stain"
                                    style={{
                                      background: darkenHex(color, 65),
                                      ...buildStainStyle(stainSeed + 37, width, height)
                                    } as CSSProperties}
                                  />
                                )}
                                <span className="leaflet-wear" style={{ opacity: shelfStyle.wear }} />
                              </>
                            )}
                            {hasRibbon && (
                              <span className="absolute -top-2 left-1/2 h-5 w-1.5 -translate-x-1/2 rounded-full bg-white/70" />
                            )}
                          </div>
                          <div className="leaflet-book-tooltip opacity-0 transition-all duration-300 ease-out group-hover:opacity-100">
                            <p className="text-xs font-semibold text-on-surface">{minutesLabel(minutes)}</p>
                            <p className="text-[10px] text-on-surface-variant">
                              {date.toLocaleDateString()} / {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                            <p className="mt-2 text-[11px] text-on-surface-variant">
                              {session.title ?? "Free read"}
                            </p>
                            <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
                              {streakCount}x focus / {Math.round(minutes * 1)} pages
                            </div>
                            <div className="mt-2 h-1.5 w-full rounded-full bg-surface-container-highest">
                              <div
                                className="h-1.5 rounded-full bg-primary"
                                style={{ width: `${Math.min(100, (minutes / Math.max(goal.target, 1)) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
            {sortedSessions.length === 0 && (
              <div className="w-full rounded-2xl border border-dashed border-outline-variant/40 p-6 text-sm text-on-surface-variant">
                Start a focus session to grow your bookshelf.
              </div>
            )}
          </div>
        </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Monthly Reading</p>
          <div className="mt-5 grid gap-1" style={{ gridTemplateColumns: "repeat(30, minmax(0, 1fr))" }}>
            {monthlyChart.map((minutes, index) => (
              <div
                key={`${minutes}-${index}`}
                title={`${minutesLabel(minutes)} on ${last30Keys[index]}`}
                className="h-10 rounded-full bg-primary/20"
                style={{ opacity: Math.min(1, minutes / Math.max(goal.target, 1)) }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Weekly Summary</p>
          <div className="mt-4 space-y-3">
            {weeklyKeys.map((key) => {
              const minutes = dailySource[key]?.minutes ?? 0;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-20 text-xs text-on-surface-variant">{key.slice(5)}</span>
                  <div className="h-2 flex-1 rounded-full bg-surface-container-highest">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${Math.min(100, (minutes / Math.max(goal.target, 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs text-on-surface-variant">{minutesLabel(minutes)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-outline-variant/20 bg-surface-container-low p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Reading Heatmap (30 days)</p>
        <div className="mt-5 grid grid-cols-10 gap-2">
          {last30Keys.map((key) => {
            const minutes = dailySource[key]?.minutes ?? 0;
            const intensity = Math.min(1, minutes / Math.max(goal.target, 1));
            return (
              <div
                key={key}
                title={`${key}: ${minutesLabel(minutes)}`}
                className="h-6 rounded-md bg-primary/20"
                style={{ opacity: 0.25 + intensity * 0.75 }}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
};
