const { getSiteConfig } = require("./siteConfig");

function resolveAttendanceCycle(siteId) {
  const cfg = getSiteConfig(siteId);

  // =====================
  // Calendar month
  // =====================
  if (cfg.cycle === "CALENDAR") {
    return {
      type: "CALENDAR",
      label: (y, m) => `01-${m}-${y} to ${new Date(y, m, 0).getDate()}-${m}-${y}`,
      buildRange(year, month) {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0);
        return { start, end };
      },
    };
  }

  // =====================
  // Default 26–25
  // =====================
  return {
    type: "26_25",
    label: (y, m) => `26-${m - 1}-${y} to 25-${m}-${y}`,
    buildRange(year, month) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;

      const start = new Date(prevYear, prevMonth - 1, 26);
      const end = new Date(year, month - 1, 25);

      return { start, end };
    },
  };
}

module.exports = { resolveAttendanceCycle };
