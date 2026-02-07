const { getSiteConfig } = require("./siteConfig");

function resolveAttendanceCycle(siteId) {
  const cfg = getSiteConfig(siteId);

  // =====================
  // Calendar month (1–EOM)
  // =====================
  if (cfg.cycle === "CALENDAR") {
    return {
      type: "CALENDAR",
      label: (y, m) =>
        `01-${m}-${y} to ${new Date(y, m, 0).getDate()}-${m}-${y}`,
      buildRange(year, month) {
        return {
          start: new Date(year, month - 1, 1),
          end: new Date(year, month, 0),
        };
      },
    };
  }

  // =====================
  // JPL: 21–20
  // =====================
  if (cfg.cycle === "21_20") {
    return {
      type: "21_20",
      label: (y, m) => {
        const prevMonth = m === 1 ? 12 : m - 1;
        const prevYear = m === 1 ? y - 1 : y;

        return `21-${prevMonth}-${prevYear} to 20-${m}-${y}`;
      },
      buildRange(year, month) {
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;

        const start = new Date(prevYear, prevMonth - 1, 21);
        const end = new Date(year, month - 1, 20);

        return { start, end };
      },
    };
  }

  // =====================
  // Default NTPC: 26–25
  // =====================
  return {
    type: "26_25",
    label: (y, m) => {
      const prevMonth = m === 1 ? 12 : m - 1;
      const prevYear = m === 1 ? y - 1 : y;

      return `26-${prevMonth}-${prevYear} to 25-${m}-${y}`;
    },
    buildRange(year, month) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;

      return {
        start: new Date(prevYear, prevMonth - 1, 26),
        end: new Date(year, month - 1, 25),
      };
    },
  };
}

module.exports = { resolveAttendanceCycle };
