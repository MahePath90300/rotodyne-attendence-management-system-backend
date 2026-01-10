// shared/attendanceCycle.js

export const ATTENDANCE_CYCLES = {
  DEFAULT_26_25: {
    startDay: 26,
    type: "CROSS_MONTH",
    label: (year, month) => {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      return `26/${prevMonth}/${prevYear} – 25/${month}/${year}`;
    },
    buildRange(year, month) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      return {
        start: new Date(prevYear, prevMonth - 1, 26),
        end: new Date(year, month - 1, 25),
      };
    },
  },

  CALENDAR_1_EOM: {
    startDay: 1,
    type: "CALENDAR",
    label: (year, month) => {
      const lastDay = new Date(year, month, 0).getDate();
      return `1/${month}/${year} – ${lastDay}/${month}/${year}`;
    },
    buildRange(year, month) {
      return {
        start: new Date(year, month - 1, 1),
        end: new Date(year, month, 0),
      };
    },
  },
};

/**
 * Site → Cycle mapping
 */
export const SITE_ATTENDANCE_CYCLE = {
  // NTPC (default)
  GADARWARA: "DEFAULT_26_25",
  KANIHA: "DEFAULT_26_25",
  TALCHER: "DEFAULT_26_25",

  // New sites
  "NALCO DAMANJODI(0405)": "CALENDAR_1_EOM",
  IOCLGJBS: "CALENDAR_1_EOM",
};

/**
 * Resolver (safe)
 */
export function resolveAttendanceCycle(siteId) {
  const key = SITE_ATTENDANCE_CYCLE[siteId] || "DEFAULT_26_25";
  return ATTENDANCE_CYCLES[key];
}
