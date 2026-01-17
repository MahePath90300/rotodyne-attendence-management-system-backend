const ExcelJS = require("exceljs");
const { addDays, format } = require("date-fns");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Holiday = require("../models/Holiday");
const AttendanceSummary = require("../models/AttendanceSummary");
const { resolveWagePolicy } = require("../config/wagePolicy");

const FILL = {
  ATTENDANCE: { argb: "FFE8F2FF" }, // light blue
  EARNINGS: { argb: "FFE9FBE7" }, // light green
  DEDUCTIONS: { argb: "FFFFF1E6" }, // light orange
  NET: { argb: "FFFFF9DB" }, // light yellow
};

function n(v) {
  return Number(v) || 0;
}

const WAGE_HEADERS = [
  "Sl No",
  "Month",
  "Emp No",
  "Site",
  "Employee Name",
  "Dsg",
  "Cat",
  "Manpwr Typ",
  "Gross",
  "V%",
  "Daily MinW",
  "Total Days",
  "Prsnt Days",
  "Abs Days",
  // "Week off Days",
  "C Off Days",
  "Holidays",
  "Paid Days",
  "Site Days",

  // ===== Earnings =====
  "Erng BA+DA",
  "Erng ADA",
  "Erng HRA",
  "Erng Conv",
  "Erng Med",
  "Erng Sub Tot",
  "Erng OnBasic",
  "Erng OnDuty",
  "Erng Sub Tot",
  "Erng Site DA",
  "OT Hrs",
  "Erng OT Amt",
  "Erng Oth Pay",
  "Erng Arrear",
  "Erng Total",

  // ===== Deductions =====
  "Dedn EPF",
  "Dedn ESI",
  "Dedn Loan",
  "Dedn TDS",
  "Dedn Advance",
  "Dedn PTAX",
  "Dedn Other",
  "Dedn Total",

  "Net Payable",
];

function calculateDailyWage(Employee, paidDays, DAILY_WAGE_BY_CAT) {
  // Rule 2: Fixed salary employee
  if (Employee.salaryType === "FIXED") {
    return n(Employee.salary) || 0;
  }

  // Rule 3: Minimum Wage Based
  const dailyRate = DAILY_WAGE_BY_CAT[Employee.category] || 0;
  return dailyRate * paidDays;
}

// same 26–25 window you already use everywhere
function buildMonthWindow(year, month) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const startDate = new Date(prevYear, prevMonth - 1, 26);
  const endDate = new Date(year, month - 1, 25);
  const days = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    days.push(format(d, "yyyy-MM-dd"));
  }
  return {
    start: format(startDate, "yyyy-MM-dd"),
    end: format(endDate, "yyyy-MM-dd"),
    days,
  };
}

/**
 * GET /api/v1/wage/site/:siteId/export?year=YYYY&month=MM
 * Only ADMIN is allowed to export.
 */
exports.exportSiteWageSheet = async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!siteId || !year || !month) {
      return res.status(400).json({ message: "siteId, year, month required" });
    }

    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res
        .status(403)
        .json({ message: "Only admin can export wage sheet" });
    }

    const policy = resolveWagePolicy(siteId);

    const { start, end, days } = buildMonthWindow(year, month);

    // 1) employees of this site sorted by name
    const employees = await Employee.find({ site: siteId })
      .sort({ name: 1 })
      .lean();

    if (!employees.length) {
      return res.status(404).json({ message: "No employees for this site" });
    }

    // 2) attendance in that window (status + otHours)
    const attDocs = await Attendance.find({
      siteId,
      date: { $gte: start, $lte: end },
    }).lean();

    // Build maps: statuses and ot
    const attByEmp = {}; // { empNo: { iso: status } }
    const otByEmp = {}; // { empNo: { iso: otHours } }

    for (const doc of attDocs) {
      if (!attByEmp[doc.empNo]) attByEmp[doc.empNo] = {};
      if (!otByEmp[doc.empNo]) otByEmp[doc.empNo] = {};
      if (doc.status) attByEmp[doc.empNo][doc.date] = doc.status;
      if (typeof doc.otHours !== "undefined" && doc.otHours !== null) {
        otByEmp[doc.empNo][doc.date] = Number(doc.otHours) || 0;
      }
    }

    // 3) holidays for this site (use holiday collection 'site' field) -> public holidays
    const holidayDocs = await Holiday.find({
      site: siteId,
      date: { $gte: start, $lte: end },
    }).lean();
    const holidaySet = new Set(holidayDocs.map((h) => h.date)); // site-level public holidays

    // 4) Sundays in that window
    const sundaySet = new Set(
      days.filter((iso) => new Date(iso).getDay() === 0),
    );

    // 5) Load AttendanceSummary entries for this site / month (to read per-employee totalHolidays)
    const summaries = await AttendanceSummary.find({
      siteId,
      year,
      month,
    }).lean();
    const summaryByEmp = {};
    for (const s of summaries) {
      // empNo might be number or missing (site-level summary may be present)
      if (typeof s.empNo !== "undefined" && s.empNo !== null) {
        summaryByEmp[s.empNo] = s;
      } else if (s.siteId && !s.empNo) {
        // site-level summary: ignore for per-emp mapping (we rely on employee summaries)
      }
    }

    // 6) build workbook
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Wage Sheet", {
      views: [
        {
          state: "frozen",
          ySplit: 1, // header row
          xSplit: 9, // Sl No → Category
        },
      ],
    });

    // ===== HEADER ROW (GADARWARA STYLE) =====
    ws.addRow(WAGE_HEADERS);
    const headerRow = ws.getRow(1);

    headerRow.font = {
      bold: true,
      size: 10,
    };

    headerRow.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };

    headerRow.height = 36;

    headerRow.font = { bold: true, size: 10 };
    headerRow.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    headerRow.height = 36;

    headerRow.eachCell((cell, colNumber) => {
      let fillColor = FILL.ATTENDANCE;

      if (colNumber >= 19 && colNumber <= 33) {
        fillColor = FILL.EARNINGS;
      } else if (colNumber >= 34 && colNumber <= 41) {
        fillColor = FILL.DEDUCTIONS;
      } else if (colNumber === 42) {
        fillColor = FILL.NET;
      }

      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: fillColor,
      };

      cell.border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // column widths (tweakable)
    const colWidths = [
      6, 6, 6, 8, 24, 8, 8, 8, 8, 5, 8, 8, 8, 8, 8, 8, 8, 6, 8, 6, 8, 6, 8, 8,
      8, 6, 8, 6, 6, 8, 8, 8, 8, 8, 6, 6, 8, 8, 8, 8, 8, 10,
    ];
    ws.columns = colWidths.map((w) => ({ width: w }));

    // serial
    let sl = 1;

    // Precompute site-level calendar counts
    const calendarDays = days.length;
    const grandTotals = {};

    for (const emp of employees) {
      const cat = (emp.category || "").toUpperCase();
      const dailyWage = resolveDailyWage(emp, policy);

      // per-employee attendance + ot maps
      const empAtt = attByEmp[emp.empNo] || {};
      const empOtMap = otByEmp[emp.empNo] || {};

      // ===== FIXED SALARY FLAGS (SAFE DEFAULTS) =====
      const isFixed = emp.salaryType === "FIXED";

      const grossIncludesDeductions =
        isFixed && typeof emp.grossIncludesDeductions === "boolean"
          ? emp.grossIncludesDeductions
          : false;

      const esiApplicable = !isFixed || emp.esiApplicable !== false;

      const otherDednApplicable =
        !isFixed || emp.otherDeductionsApplicable !== false;

      // If AttendanceSummary provides employee totalHolidays, use it (preferred)
      const summary = summaryByEmp[emp.empNo] || {};
      const summaryHolidays = summary?.totalHolidays; // may be undefined

      const presentDays =
        n(summary?.totalPresentDays || 0) +
        n(summary?.totalHoilidayWorkingDays || 0);
      const weekOffDays = Number(summary.totalWeekOffs || 0);
      const coffDays = n(summary.totalCOffs || summary.totalCOffDays || 0);
      const otHours = n(summary.otHours || 0);
      const totalDaysForSite =
        n(summary.totalDaysWorked) + n(summary?.totalHolidays);

      const holidaysCount =
        presentDays >= totalDaysForSite && emp.empNo !== 14227
          ? 0
          : n(summaryHolidays);
      const paidDays =
        presentDays === 0 ? 0 : presentDays + coffDays + holidaysCount;
      const gross =
        emp.salaryType === "FIXED" ? emp.salary : dailyWage * totalDaysForSite;
      const totalDays = totalDaysForSite;

      const otDivisor = policy.otRateDivisor || 4;
      const erngOtAmt = (dailyWage / otDivisor) * otHours;

      const erngBaDa = dailyWage * paidDays;
      const perDayGross = totalDays > 0 ? (gross * paidDays) / totalDays : 0;
      const balance = perDayGross - erngBaDa;

      const erngHra = balance * 0.5;
      const erngConv = balance * 0.35;
      const erngMed = balance * 0.15;
      const erngArrear = 0;

      const erngOtherPerDay =
        typeof policy.erngOtherPayAmount === "object"
          ? policy.erngOtherPayAmount[siteId] || 0
          : policy.erngOtherPayAmount || 0;
      const erngOtherPay = paidDays * erngOtherPerDay;
      const erngSiteDa = 0;
      const erngAda = 0;

      let erngOnBas = 0;
      let erngOnDuty = 0;
      let dednESI = 0;

      // Earn on Basic
      const onBasicPercent =
        typeof policy.erngOnBasicPercent === "object"
          ? policy.erngOnBasicPercent[siteId] || 0
          : policy.erngOnBasicPercent || 0;

      erngOnBas = erngBaDa * onBasicPercent;

      // Earn on Duty
      const onDutyPerDay =
        typeof policy.erngOnDutyPerDay === "object"
          ? policy.erngOnDutyPerDay[siteId] || 0
          : policy.erngOnDutyPerDay || 0;

      erngOnDuty = paidDays * onDutyPerDay;

      const esiPolicy =
        typeof policy.esi === "object" && policy.esi[siteId]
          ? policy.esi[siteId]
          : policy.esi;

      dednESI = resolveESI(
        erngBaDa,
        erngOnDuty,
        gross,
        esiPolicy,
        emp?.esiApplicable,
      );

      const erngBaDaR = round2(erngBaDa);
      const erngHraR = round2(erngHra);
      const erngConvR = round2(erngConv);
      const erngMedR = round2(erngMed);
      const erngOnBasR = round2(erngOnBas);
      const erngOnDutyR = round2(erngOnDuty);
      const erngOtAmtR = round2(erngOtAmt);
      const erngOtherPayR = round2(erngOtherPay);

      const erngSubTot1 = erngBaDaR + erngHraR + erngConvR + erngMedR + erngAda;

      const erngSubTot2 = erngSubTot1 + erngOnBasR + erngOnDutyR;
      const erngTotal =
        erngArrear + erngOtherPayR + erngOtAmtR + erngSiteDa + erngSubTot2;

      const pfBase = resolveContributionBase(erngBaDa, erngOnDuty, policy.pf);

      const dednEPF = policy.pf?.enabled
        ? Math.min(pfBase * policy.pf.percent, policy.pf.maxAmount || Infinity)
        : 0;

      const paidDaysWage = Math.max(0, paidDays) * dailyWage;
      const dednLon = 0;
      const dednTds = 0;
      const dednAdv = 0;
      const dednPtax = 0;

      const hasFixedOtherDedn =
        typeof emp?.otherDeductionAmount === "number" &&
        emp.otherDeductionAmount > 0;

      const dednOther =
        emp?.grossIncludesDeductions !== true &&
        otherDednApplicable &&
        policy.dednOtherEnabled
          ? hasFixedOtherDedn
            ? n(emp.otherDeductionAmount) // ✅ client override (MWB + FIXED)
            : isFixed
              ? n(erngOnBas + erngOnDuty) // ✅ FIXED fallback
              : 0
          : 0;

      const dednEPFR = round2(dednEPF);
      const dednESIR = roundUp(dednESI);
      const dednOtherR = round2(dednOther);

      const dednTotal =
        dednEPFR +
        dednESIR +
        dednLon +
        dednTds +
        dednAdv +
        dednPtax +
        dednOtherR;

      let netPayable = 0;

      if (isFixed && grossIncludesDeductions) {
        netPayable = Math.floor(gross - (dednEPFR + dednESIR));
      } else {
        netPayable = Math.floor(erngTotal - dednTotal);
      }

      const absDays = totalDays - paidDays;

      const rowValues = [
        sl, // Sl no
        month, // Month numbr
        emp.empNo || "", // Emp no
        siteId,
        emp.name || "", // Name
        emp.designation || "", // Dsg
        emp.category || "", // Cat
        emp.manpowerType || emp.siteType || "" || "", // Manpwr Typ
        gross, // Gross
        0, // v% (reserved)
        dailyWage, // Daily Minw
        totalDays, // Total days (site-level rule)
        presentDays, // Prsnt Days (PP + P + HW)
        absDays, // Abs days
        // round2(weekOffDays), // CL day (CC)
        coffDays, // Coff Days
        n(holidaysCount || 0), // Holidays (prefer AttendanceSummary.totalHolidays)
        paidDays, // Paid Days (present + CC + WW - HW)
        0, // Site days (reserved)
        round2(erngBaDaR), // Emg ba+da (reserved)
        0, // EmAda (reserved)
        round2(erngHraR), // Emg HRA (reserved)
        round2(erngConvR), // Emg Conv (reserved)
        round2(erngMedR), // Emg Med (reserved)
        round2(erngSubTot1), // Emg Sub Tot (reserved)
        round2(erngOnBasR), // Emg onBas (reserved)
        erngOnDuty,
        round2(erngSubTot2), // Emg Sub Tot (reserved)
        0, // EMg SitDa (reserved)
        otHours, // OT hrs
        round2(erngOtAmtR), // Earng OTamt
        round2(erngOtherPayR), // Emg othPy (reserved)
        0, // Emg Arrear (reserved)
        round2(erngTotal), // Emg total (paidDays*dailyWage + ot)
        round2(dednEPFR), // dedn EPF (12% on paid days*dailyWage)
        roundUp(dednESIR), // dedn ESI (2% on paid days*dailyWage)
        round2(dednLon), // Ded Lon
        round2(dednTds), // Ded TDS
        round2(dednAdv), // Ded Adv
        round2(dednPtax), // Ded ptax (not calculated)
        round2(dednOther), // Ded oth
        round2(dednTotal), // Dedn total
        netPayable, // Net payable
      ];

      rowValues.forEach((val, idx) => {
        // columns starting from Gross (index 8, 0-based = 7)
        if (idx >= 7 && typeof val === "number") {
          grandTotals[idx] = (grandTotals[idx] || 0) + val;
        }
      });

      const newRow = ws.addRow(rowValues);
      applySectionBorders(newRow);
      applySectionBorders(headerRow);

      // formatting for numeric cells
      newRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // Alignment
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber === 4 ? "left" : "center",
        };

        if ((colNumber === 29 || colNumber === 30) && Number(cell.value) > 0) {
          cell.font = {
            color: { argb: "FFFF0000" }, // red
            bold: true,
          };
        }

        // ---- BACKGROUND COLORS ----
        if (colNumber >= 1 && colNumber <= 18) {
          // Attendance & base info
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: FILL.ATTENDANCE,
          };
        }

        if (colNumber >= 19 && colNumber <= 33) {
          // Earnings
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: FILL.EARNINGS,
          };
        }

        if (colNumber >= 34 && colNumber <= 41) {
          // Deductions
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: FILL.DEDUCTIONS,
          };
        }

        if (colNumber === 42) {
          // Net Payable
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: FILL.NET,
          };
          cell.font = { bold: true };
        }

        // Borders
        cell.border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
      });

      // alternate row shading
      // if (sl % 2 === 0) {
      //   newRow.eachCell((cell) => {
      //     cell.fill = {
      //       type: "pattern",
      //       pattern: "solid",
      //       fgColor: { argb: "FFF8FAFB" },
      //     };
      //   });
      // }

      sl += 1;
    }

    const totalRowValues = Array(WAGE_HEADERS.length).fill("");

    // Label
    totalRowValues[4] = "TOTAL – CURRENT MONTH";

    // Fill totals
    Object.keys(grandTotals).forEach((idx) => {
      totalRowValues[idx] = grandTotals[idx];
    });

    const totalRow = ws.addRow(totalRowValues);

    totalRow.font = { bold: true };

    totalRow.eachCell((cell, colNumber) => {
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 5 ? "left" : "center",
      };

      // Background (same header blue)
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9EAF7" }, // light blue
      };

      // Thick top border
      cell.border = {
        top: { style: "thick" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };

      // Currency format
      // if (typeof cell.value === "number") {
      //   cell.numFmt = "#,##0.00";
      // }
    });

    // stream workbook to response
    const fileName = `wage_sheet_${siteId}_${year}_${month}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

function applySectionBorders(row) {
  const thickCols = [18, 33, 41];

  thickCols.forEach((col) => {
    const cell = row.getCell(col);
    cell.border = {
      ...cell.border,
      right: { style: "thick" },
    };
  });
}

// small helper
function round2(v) {
  if (v === null || v === undefined || isNaN(v)) return 0;
  return Math.round(v);
}

function roundUp(v) {
  if (v === null || v === undefined || isNaN(v)) return 0;
  return Math.ceil(v);
}

function roundDown(v) {
  if (v === null || v === undefined || isNaN(v)) return 0;
  return Math.floor(v);
}

function resolveDailyWage(emp, policy) {
  // ✅ NALCO / custom sites
  if (Number(emp.dailyWageRate) > 0) {
    return Number(emp.dailyWageRate);
  }

  // ✅ NTPC / IOCL
  return policy.dailyWageByCategory?.[emp.category] || 0;
}

function resolveESI(erngBaDa, erngOnDuty, gross, esiPolicy, esiApplicable) {
  if (!esiPolicy?.enabled) return 0;

  // 🔹 Deduction base is ALWAYS earned wages
  const base = resolveContributionBase(erngBaDa, erngOnDuty, esiPolicy);
  if (base <= 0) return 0;

  // 🔹 Ceiling blocks ONLY when esiApplicable is NOT explicitly true
  if (esiPolicy.applyCeiling !== false && esiApplicable !== true) {
    if (esiPolicy.ceiling && gross >= esiPolicy.ceiling) {
      return 0;
    }
  }

  // 🔹 If esiApplicable === false → never deduct
  if (esiApplicable === false) return 0;

  let amt = base * esiPolicy.percent;

  if (esiPolicy.maxAmount) {
    amt = Math.min(amt, esiPolicy.maxAmount);
  }

  return amt;
}

function resolveContributionBase(erngBaDa, erngOnDuty, policySection) {
  if (!policySection?.enabled) return 0;

  return policySection.includeOnDuty ? erngBaDa + erngOnDuty : erngBaDa;
}
