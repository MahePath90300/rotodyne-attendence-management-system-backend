const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const { addDays, format, min } = require("date-fns");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Holiday = require("../models/Holiday");
const AttendanceSummary = require("../models/AttendanceSummary");
const { resolveWagePolicy } = require("../config/wagePolicy");
const { resolveAttendanceCycle } = require("../config/attendanceCycle");
const { header } = require("express-validator");
const wageService = require("../Services/wage.service");

const FILL = {
  ATTENDANCE: { argb: "FFE8F2FF" }, // light blue
  EARNINGS: { argb: "FFE9FBE7" }, // light green
  DEDUCTIONS: { argb: "FFFFF1E6" }, // light orange
  NET: { argb: "FFFFF9DB" }, // light yellow
};

// Columns whose values should appear in BLUE
const BLUE_VALUE_COLUMNS = new Set([
  9, // Gross
  19, // Erng BA+DA
  24, // Erng Sub Tot (1)
  27, // Erng Sub Tot (2)
  33, // Erng Total
  42, // Net Payable
]);

const DESIGNATION_KEY_MAP = {
  BTECH: "BTech",
  GRADUATE: "Graduate",
  DIPLOMA: "Diploma",
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
  "F&F",
  "Empr PF",
  "Empr ESI",
  "Total CTC",
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

    const policy = await resolveWagePolicy(siteId);

    const cycle = resolveAttendanceCycle(siteId);
    const { start, end } = cycle.buildRange(year, month);

    const days = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      days.push(format(d, "yyyy-MM-dd"));
    }

    // 1) employees of this site sorted by name
    const employees = await Employee.find({ site: siteId })
      .sort({ name: 1 })
      .lean();

    if (!employees.length) {
      return res.status(404).json({ message: "No employees for this site" });
    }

    // 2) attendance in that window (status + otHours)
    const startStr = format(new Date(start), "yyyy-MM-dd");
    const endStr = format(new Date(end), "yyyy-MM-dd");

    const attDocs = await Attendance.find({
      siteId,
      date: { $gte: startStr, $lte: endStr },
    }).lean();

    // Build maps: statuses and ot
    const attByEmp = {}; // { empNo: { iso: status } }
    const otByEmp = {}; // { empNo: { iso: otHours } }

    for (const doc of attDocs) {
      const isoDate = format(new Date(doc.date), "yyyy-MM-dd");

      if (!attByEmp[doc.empNo]) attByEmp[doc.empNo] = {};
      if (!otByEmp[doc.empNo]) otByEmp[doc.empNo] = {};

      if (doc.status) {
        attByEmp[doc.empNo][isoDate] = doc.status;
      }

      if (doc.otHours !== undefined && doc.otHours !== null) {
        otByEmp[doc.empNo][isoDate] = Number(doc.otHours) || 0;
      }
    }

    // 3) holidays for this site (use holiday collection 'site' field) -> public holidays
    const holidayDocs = await Holiday.find({
      site: siteId,
      date: { $gte: startStr, $lte: endStr },
    }).lean();

    const holidaySet = new Set(
      holidayDocs.map((h) => format(new Date(h.date), "yyyy-MM-dd")),
    );
    // site-level public holidays

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
          ySplit: 2, // header row
          xSplit: 9, // Sl No → Category
        },
      ],
    });

    // ===== HEADER ROW (GADARWARA STYLE) =====
    const cycleLabel = cycle.label(year, month);
    ws.getCell("A1").value =
      ` (RES)   SALARY CALCULATION SHEET: ${policy.group} ${siteId} (${cycleLabel})`;
    ws.addRow(WAGE_HEADERS);

    const headerRow = ws.getRow(2);

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

      // If AttendanceSummary provides employee totalHolidays, use it (preferred)
      const summary = summaryByEmp[emp.empNo] || {};

      const presentDays = n(summary?.totalPresentDays || 0);
      const weekOffDays = Number(summary.totalWeekOffs || 0);
      const coffDays = n(summary.totalCOffs || summary.totalCOffDays || 0);
      const otHours = n(summary.otHours || 0);
      const totalDaysForSite = days.length - sundaySet.size;

      const empHolidayDays = calculateEmployeeHolidayDays({
        days,
        holidaySet,
        sundaySet,
        empAtt,
        presentDays,
      });

      const siteDays = n(summary?.siteDays);

      const paidDays =
        presentDays === 0 ? 0 : presentDays + coffDays + empHolidayDays;

      const gross =
        emp.salaryType === "FIXED" ? emp.salary : dailyWage * totalDaysForSite;
      const totalDays = totalDaysForSite;

      const erngOtAmt = resolveOTAmount({
        siteId,
        emp,
        policy,
        otHours,
        dailyWage,
      });

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
      const erngSiteDa = n(emp?.siteDa);
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
        erngTotal,
      );

      const pfBase = resolveContributionBase(erngBaDa, erngOnDuty, policy.pf);

      const dednEPF =
        policy.pf?.enabled && emp?.pfApplicable !== false
          ? Math.min(
              pfBase * policy.pf.percent,
              policy.pf.maxAmount || Infinity,
            )
          : 0;

      const dednEPFIncAdmin =
        policy.pf?.enabled && emp?.pfApplicable !== false
          ? Math.min(pfBase * 0.12, policy.pf.maxAmount || Infinity) +
            pfBase * 0.01
          : 0;

      const paidDaysWage = Math.max(0, paidDays) * dailyWage;
      const dednLon = 0;
      const dednTds = 0;
      const dednAdv = 0;
      const dednPtax = (paidDays !== 0 ? emp?.pTax : 0) ?? 0;

      const dednOther = resolveOtherDeduction({
        emp,
        siteId,
        salaryType: emp.salaryType,
        policy,
        erngTotal,
        erngOnBas,
        erngOnDuty,
        paidDays,
        otHours,
        erngOtAmt,
      });

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
      const fnfPolicy = policy.fnf || {};

      let leaveEncashment = 0;
      let refreshment = 0;
      let noticePay = 0;
      let bonus = 0;

      if (fnfPolicy.enabled !== false && !fnfPolicy.includedInOnBasic) {
        if (fnfPolicy.components?.leaveEncashment) {
          leaveEncashment = erngBaDa * 0.05;
        }

        if (fnfPolicy.components?.refreshment) {
          refreshment = erngBaDa * 0.049;
        }

        if (fnfPolicy.components?.noticePay) {
          noticePay = erngBaDa * 0.049;
        }
        if (fnfPolicy.components?.bonus) {
          bonus = erngBaDa * 0.0833;
        }
      }

      const totalFnf = leaveEncashment + refreshment + noticePay + bonus;
      const totalFnfR =
        round2(leaveEncashment) +
        round2(refreshment) +
        round2(noticePay) +
        round2(bonus);

      const employerPF = round2(dednEPFIncAdmin);
      const employerESI = round2(Number((dednESI / 0.0075) * 0.0325)) || 0;

      const salary = round2(erngSubTot1);
      const allowances =
        erngOnBasR + erngOnDutyR + erngSiteDa + erngOtherPay + erngArrear;

      const totalCTC =
        salary +
        erngOtAmtR +
        round2(allowances) +
        totalFnfR +
        employerPF +
        employerESI;

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
        round2(gross), // Gross
        0, // v% (reserved)
        dailyWage, // Daily Minw
        totalDays, // Total days (site-level rule)
        presentDays, // Prsnt Days (PP + P + HW)
        absDays, // Abs days
        // round2(weekOffDays), // CL day (CC)
        coffDays, // Coff Days
        empHolidayDays || 0, // Holidays (prefer AttendanceSummary.totalHolidays)
        paidDays, // Paid Days (present + CC + WW - HW)
        siteDays, // Site days (reserved)
        round2(erngBaDaR), // Emg ba+da (reserved)
        0, // EmAda (reserved)
        round2(erngHraR), // Emg HRA (reserved)
        round2(erngConvR), // Emg Conv (reserved)
        round2(erngMedR), // Emg Med (reserved)
        round2(erngSubTot1), // Emg Sub Tot (reserved)
        round2(erngOnBasR), // Emg onBas (reserved)
        erngOnDuty,
        round2(erngSubTot2), // Emg Sub Tot (reserved)
        erngSiteDa, // EMg SitDa (reserved)
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
        round2(totalFnf), //F&F
        employerPF, //employer pf
        employerESI, //employer ESI
        totalCTC,
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

        // 🔵 BLUE IMPORTANT VALUES
        if (BLUE_VALUE_COLUMNS.has(colNumber)) {
          cell.font = {
            color: { argb: "FF1F4ED8" }, // Excel blue
            bold: true,
          };
        }

        if (
          colNumber === 29 ||
          colNumber === 30 ||
          colNumber === 43 ||
          colNumber === 44 ||
          colNumber === 45 ||
          colNumber === 46
        ) {
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
          cell.font = {
            ...(cell.font || {}),
            bold: true,
          };
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
    const fileName = `wage_sheet_${policy.group}${siteId}_${year}_${month}.xlsx`;
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

exports.exportESIChallan = async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    // ---------- VALIDATION ----------
    if (!siteId || !year || !month) {
      return res.status(400).json({ message: "siteId, year, month required" });
    }

    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ message: "Only admin can export ESI" });
    }

    // ---------- LOAD POLICY & CYCLE ----------
    const policy = await resolveWagePolicy(siteId);

    if (!policy.esi?.enabled) {
      return res
        .status(403)
        .json({ message: "ESI is not applicable for this site" });
    }
    const cycle = resolveAttendanceCycle(siteId);
    const { start, end } = cycle.buildRange(Number(year), Number(month));

    const daysInCycle = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      daysInCycle.push(format(d, "yyyy-MM-dd"));
    }

    const sundaySet = new Set(
      daysInCycle.filter((iso) => new Date(iso).getDay() === 0),
    );

    const totalDaysForSite = daysInCycle.length - sundaySet.size;

    // ---------- LOAD EMPLOYEES ----------
    const allEmployees = await Employee.find({ site: siteId })
      .sort({ name: 1 })
      .lean();

    const employees = allEmployees.filter((emp) => emp.salaryType === "MWB");

    if (!employees.length) {
      return res
        .status(404)
        .json({ message: "No employees found for this site" });
    }

    // ---------- LOAD ATTENDANCE SUMMARY ----------
    const summaries = await AttendanceSummary.find({
      siteId,
      year: Number(year),
      month: Number(month),
    }).lean();

    const summaryByEmp = {};
    summaries.forEach((s) => {
      if (s.empNo) summaryByEmp[s.empNo] = s;
    });

    // ========== CREATE NEW WORKBOOK ==========
    const wb = new ExcelJS.Workbook();

    // ========== MAIN ESI SHEET ==========
    const ws = wb.addWorksheet("ESI Export");

    // ---------- TITLE ROW (MATCHES YOUR FORMAT) ----------
    const monthLabel = `${year}${String(month).padStart(2, "0")}`;
    const cycleLabel = cycle.label(year, month);

    ws.addRow([`${policy.group} ${siteId} ESI FOR MONTH : ${cycleLabel}`]);

    ws.getRow(1).font = { bold: true, size: 12 };

    // ---------- HEADER ROW ----------
    const headers = [
      "Sl No",
      "IP Number",
      "Stno",
      "IP Name",
      "No of Days paid",
      "Total Monthly Wages",
      "ESI amt",
      "Employer share (3.25%)",
      "Total",
    ];

    ws.addRow(headers);

    ws.getRow(2).font = { bold: true };
    ws.getRow(2).alignment = { horizontal: "center" };

    // Column widths similar to your sheet
    ws.columns = [
      { width: 6 },
      { width: 12 }, // IP Number
      { width: 8 }, // Stno
      { width: 18 }, // Name
      { width: 10 }, // Days paid
      { width: 10 }, // Monthly wages
      { width: 8 }, // esi amt
      { width: 10 }, // employer share
      { width: 8 }, // Total
    ];

    // ---------- ESI POLICY ----------
    const esiPolicy =
      typeof policy.esi === "object" && policy.esi[siteId]
        ? policy.esi[siteId]
        : policy.esi;

    let totalESIBase = 0;
    let totalEmpESI = 0;
    let totalEmprESI = 0;
    let totalPaidDays = 0;
    let totalErngBaDa = 0;
    let totalESITot = 0;

    let sl = 1;
    for (const emp of allEmployees) {
      const summary = summaryByEmp[emp.empNo] || {};

      const paidDays =
        n(summary.totalPresentDays) +
        n(summary.totalHoilidayWorkingDays) +
        n(summary.totalCOffDays);

      const dailyWage =
        Number(emp.dailyWageRate) > 0
          ? Number(emp.dailyWageRate)
          : policy.dailyWageByCategory?.[emp.category] || 0;

      // ===== BA + DA (THIS MUST GO TO "Total Monthly Wages") =====
      const erngBaDa = dailyWage * paidDays;

      // ===== Earn on Duty (same as wage sheet) =====
      const erngOnDuty =
        paidDays *
        (typeof policy.erngOnDutyPerDay === "object"
          ? policy.erngOnDutyPerDay[siteId] || 0
          : policy.erngOnDutyPerDay || 0);

      // ===== GROSS (for ceiling check — CORRECT) =====
      const gross =
        emp.salaryType === "FIXED"
          ? Number(emp.salary || 0)
          : dailyWage * totalDaysForSite;

      if (
        esiPolicy?.ceiling &&
        gross > esiPolicy.ceiling &&
        emp.esiApplicable !== true
      ) {
        continue;
      }

      const erngTotal = erngBaDa + erngOnDuty;

      // ===== EXACT SAME ESI AS WAGE SHEET =====
      const empESI = resolveESI(
        erngBaDa,
        erngOnDuty,
        gross, // ✅ ceiling checked on GROSS (correct)
        esiPolicy,
        emp.esiApplicable, // ✅ preserves special case
        erngTotal,
      );

      // --------- FILTER RULE (CLIENT APPROVED) ---------
      // ❌ DO NOT REMOVE emp if BA+DA > 21000 when esiApplicable === true
      if (empESI === 0 && emp.esiApplicable !== true) continue;

      // Employer share derived consistently
      const emprESI = (empESI / 0.0075) * 0.0325;
      const totalESI = empESI + emprESI;

      // ===== APPLY BA+DA CEILING ONLY FOR TOTAL COLUMN, NOT FOR ELIGIBILITY =====
      const displayErngBaDa =
        erngBaDa <= 21000 || emp.esiApplicable === true ? erngBaDa : 0;
      if (displayErngBaDa === 0) continue;

      totalPaidDays += paidDays;
      totalErngBaDa += displayErngBaDa;
      totalEmpESI += empESI;
      totalEmprESI += emprESI;
      totalESITot += totalESI;

      ws.addRow([
        sl++,
        emp.ipNumber || 0, // IP Number
        emp.empNo, // Stno
        emp.name, // IP Name
        paidDays, // No of Days paid
        Math.round(displayErngBaDa), // ✅ BA+DA in "Total Monthly Wages"
        Number(empESI.toFixed(2)), // ESI amt (matches wage sheet)
        Number(emprESI.toFixed(2)), // Employer share
        Number(totalESI.toFixed(2)), // Total
      ]);
    }

    // ======== TOTAL ROW ========
    const totalRow = ws.addRow([
      "",
      "", // IP Number
      "", // Stno
      "TOTAL", // Name column
      Math.round(totalPaidDays),
      Math.round(totalErngBaDa), // BA+DA total
      Number(round2(totalEmpESI)),
      Number(round2(totalEmprESI)),
      Number(round2(totalESITot)),
    ]);

    // Make it bold like your wage sheet
    totalRow.font = { bold: true };

    // Apply borders to total row
    totalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };

      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
    });

    // ========== SEND FILE ==========
    const fileName = `ESI_${siteId}_${month}_${year}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    applyBordersAndAutoHeight(ws);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

exports.exportPFECR = async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    // ---------- VALIDATION ----------
    if (!siteId || !year || !month) {
      return res.status(400).json({ message: "siteId, year, month required" });
    }

    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ message: "Only admin can export PF ECR" });
    }

    const policy = await resolveWagePolicy(siteId);
    if (!policy.pf?.enabled) {
      return res
        .status(403)
        .json({ message: "PF is not enabled for this site" });
    }

    const cycle = resolveAttendanceCycle(siteId);
    const { start, end } = cycle.buildRange(Number(year), Number(month));

    // build calendar days exactly like wage sheet
    const days = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      days.push(format(d, "yyyy-MM-dd"));
    }

    const sundaySet = new Set(
      days.filter((iso) => new Date(iso).getDay() === 0),
    );
    const totalDaysForSite = days.length - sundaySet.size;

    // ---------- LOAD EMPLOYEES ----------
    const employees = await Employee.find({ site: siteId })
      .sort({ name: 1 })
      .lean();

    const startStr = format(new Date(start), "yyyy-MM-dd");
    const endStr = format(new Date(end), "yyyy-MM-dd");

    const attDocs = await Attendance.find({
      siteId,
      date: { $gte: startStr, $lte: endStr },
    }).lean();

    // Build maps: statuses and ot
    const attByEmp = {}; // { empNo: { iso: status } }

    for (const doc of attDocs) {
      const isoDate = format(new Date(doc.date), "yyyy-MM-dd");

      if (!attByEmp[doc.empNo]) attByEmp[doc.empNo] = {};

      if (doc.status) {
        attByEmp[doc.empNo][isoDate] = doc.status;
      }
    }

    if (!employees.length) {
      return res
        .status(404)
        .json({ message: "No employees found for this site" });
    }

    // ---------- LOAD ATTENDANCE SUMMARY ----------
    const summaries = await AttendanceSummary.find({
      siteId,
      year: Number(year),
      month: Number(month),
    }).lean();

    const summaryByEmp = {};
    summaries.forEach((s) => {
      if (s.empNo) summaryByEmp[s.empNo] = s;
    });

    const holidayDocs = await Holiday.find({
      site: siteId,
      date: { $gte: startStr, $lte: endStr },
    }).lean();

    const holidaySet = new Set(
      holidayDocs.map((h) => format(new Date(h.date), "yyyy-MM-dd")),
    );

    // ========== CREATE WORKBOOK ==========
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("PF ECR");
    const cycleLabel = cycle.label(year, month);
    ws.addRow([`${policy.group} ${siteId} EPF ECR FOR MONTH : ${cycleLabel}`]);

    ws.getRow(1).font = { bold: true, size: 12 };

    ws.views = [
      {
        state: "frozen",
        ySplit: 2, // 👈 Freezes first 2 rows (title + header)
      },
    ];

    // ---------- HEADER (CLIENT APPROVED) ----------
    const headers = [
      "Sl No",
      "Staff Number",
      "UAN",
      "Member Name",
      "Gross Wages",
      "EPF Wages",
      "EPS Wages",
      "EDLI Wages",
      "EPF Employee (12%)",
      "EPS Employer (8.33%)",
      "Employer (3.67%)",
      "Refunds",
      "NCP Days",
      "Employee Payable (12%)",
      "Employer Payable (12%)",
      "Admin Charges (1%)",
      "Total Payable",
    ];

    ws.addRow(headers);
    ws.getRow(2).font = { bold: true };
    ws.getRow(2).alignment = { horizontal: "center" };

    ws.columns = [
      { width: 6 },
      { width: 8 },
      { width: 14 },
      { width: 22 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 8 },
      { width: 8 },
      { width: 10 }, // Employee Payable
      { width: 10 }, // Employer Payable
      { width: 10 }, // Admin Charges
      { width: 10 }, // Total Payable
    ];

    ws.getColumn(3).numFmt = "@"; // Column 3 = UAN (Text format)

    let totalGross = 0;
    let totalEPFWages = 0;
    let totalEPFEmp = 0;
    let totalEPSEmpr = 0;
    let totalEDLI = 0;
    let totalNCP = 0;

    let totalEmployeePayable = 0;
    let totalEmployerPayable = 0;
    let totalAdminCharges = 0;
    let totalNetPayable = 0;

    let sl = 1; // <-- NEW SERIAL COUNTER

    for (const emp of employees) {
      const summary = summaryByEmp[emp.empNo] || {};
      const empAtt = attByEmp[emp.empNo] || {};

      const presentDays = n(summary.totalPresentDays || 0);
      const coffDays = n(summary.totalCOffDays || 0);
      const empHolidayDays = calculateEmployeeHolidayDays({
        days,
        holidaySet,
        sundaySet,
        empAtt,
        presentDays,
      });

      const paidDays = presentDays + coffDays + empHolidayDays;
      const absDays = totalDaysForSite - paidDays;

      const dailyWage =
        Number(emp.dailyWageRate) > 0
          ? Number(emp.dailyWageRate)
          : policy.dailyWageByCategory?.[emp.category] || 0;

      const erngBaDa = dailyWage * paidDays;

      const pfWage = Math.min(erngBaDa, 15000);

      const pfBase = resolveContributionBase(erngBaDa, 0, policy.pf);

      const epfEmployee =
        policy.pf?.enabled && emp?.pfApplicable !== false
          ? Math.min(
              pfBase * policy.pf.percent,
              policy.pf.maxAmount || Infinity,
            )
          : 0;

      const epsEmployer = pfWage * 0.0833;
      const edliEmployer = pfWage * 0.0367;

      const employeePayable = epfEmployee; // Column 14
      const employerPayable = epsEmployer + edliEmployer; // Column 15
      const adminCharges = round2(pfWage * 0.01); // 1% of EPF Wages (Column 6)
      const totalPayable = employeePayable + employerPayable + adminCharges;

      totalGross += erngBaDa;
      totalEPFWages += pfWage;
      totalEPFEmp += epfEmployee;
      totalEPSEmpr += epsEmployer;
      totalEDLI += edliEmployer;
      totalNCP += absDays;

      totalEmployeePayable += employeePayable;
      totalEmployerPayable += employerPayable;
      totalAdminCharges += adminCharges;
      totalNetPayable += totalPayable;

      ws.addRow([
        sl++, // ✅ NEW: SL.NO
        emp.empNo, // Staff Number
        emp.uan ? String(emp.uan) : "N/A", // UAN
        emp.name, // Member Name
        round2(erngBaDa), // Gross Wages (BA+DA)
        round2(pfWage), // EPF Wages
        round2(pfWage), // EPS Wages
        round2(pfWage), // EDLI Wages
        round2(epfEmployee), // EPF Employee
        round2(epsEmployer), // EPS Employer
        roundDown(edliEmployer), // Employer 3.67%
        0, // Refunds
        absDays, // NCP Days
        round2(employeePayable), // Employee Payable (12%)
        round2(employerPayable), // Employer Payable (12%)
        round2(adminCharges), // Admin Charges (1%)
        round2(totalPayable), // Total Payable
      ]);
    }

    // ===== TOTAL ROW =====
    const totalRow = ws.addRow([
      "",
      "",
      "",
      "TOTAL",
      round2(totalGross),
      round2(totalEPFWages),
      round2(totalEPFWages),
      round2(totalEPFWages),
      round2(totalEPFEmp),
      round2(totalEPSEmpr),
      round2(totalEDLI),
      0,
      round2(totalNCP),
      round2(totalEmployeePayable),
      round2(totalEmployerPayable),
      round2(totalAdminCharges),
      round2(totalNetPayable),
    ]);

    totalRow.font = { bold: true };

    totalRow.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    // SEND FILE
    const fileName = `PF_ECR_${siteId}_${month}_${year}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    applyBordersAndAutoHeight(ws);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

function applyBordersAndAutoHeight(ws) {
  const lastRow = ws.lastRow.number;
  const lastCol = ws.columns.length;

  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);

    row.eachCell({ includeEmpty: true }, (cell, col) => {
      // Borders
      cell.border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };

      // Wrap text so height can auto-adjust
      cell.alignment = {
        vertical: "middle",
        horizontal: col === 3 ? "left" : "center",
        wrapText: true,
      };
    });

    // Auto height based on content
    row.height = undefined; // Let Excel auto-size based on wrapped text
  }
}

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

function resolveOtherDeduction({
  emp,
  siteId,
  salaryType,
  policy,
  erngTotal,
  erngOnBas,
  erngOnDuty,
  paidDays,
  otHours,
  erngOtAmt,
}) {
  const isFixed = salaryType === "FIXED";

  // const otherDednApplicable =
  //   !isFixed || emp.otherDeductionsApplicable !== false;

  // if (!policy.dednOtherEnabled || !otherDednApplicable) {
  //   return 0;
  // }
  // Site level switch
  if (!policy.dednOtherEnabled) {
    return 0;
  }

  // Employee must explicitly allow deduction
  if (emp.otherDeductionsApplicable !== true) {
    return 0;
  }

  // ======================================
  // 🔴 KANIHA TEMP MWB EMPLOYEES
  // ======================================
  const isKanihaTempMWB =
    siteId === "KANIHA" &&
    salaryType === "MWB" &&
    emp.isTemporary === true &&
    Number(emp.tempMinWage) > 0;

  if (isKanihaTempMWB) {
    const minWage = Number(emp.tempMinWage);
    const siteOtAmountPerHour = round2(minWage / 4);

    const clientTotalPay = minWage * paidDays + siteOtAmountPerHour * otHours;

    const diff = erngTotal - clientTotalPay;

    return diff > 0 ? Math.round(diff) : 0;
  }

  const hasSitePayAmount =
    siteId === "KANIHA" && isFixed && Number(emp.sitePayAmount) > 0;

  if (hasSitePayAmount) {
    const clientTotalPay = Number(emp.sitePayAmount);

    const diff = erngTotal - clientTotalPay;

    return diff > 0 ? Math.round(diff) : 0;
  }

  if (
    typeof emp.otherDeductionAmount === "number" &&
    emp.otherDeductionAmount > 0
  ) {
    return Math.round(emp.otherDeductionAmount);
  }

  // if (
  //   (isFixed && emp?.grossIncludesDeductions !== true) ||
  //   (emp?.grossIncludesDeductions !== true &&
  //     emp?.otherDeductionsApplicable === true)
  // ) {
  //   return Math.round(erngOnBas + erngOnDuty+ erngOtAmt);
  // }
  const cfg = emp.otherDeductionOverride
    ? emp.otherDeductionOverride
    : policy.otherDeductionComponents || {};

  if (!cfg || Object.keys(cfg).length === 0) {
    return 0;
  }

  let deduction = 0;

  if (cfg.includeOnBasic) deduction += erngOnBas || 0;
  if (cfg.includeOnDuty) deduction += erngOnDuty || 0;
  if (cfg.includeOT) deduction += erngOtAmt || 0;

  return Math.round(deduction);
}

function resolveESI(
  erngBaDa,
  erngOnDuty,
  gross,
  esiPolicy,
  esiApplicable,
  erngTotal,
) {
  if (!esiPolicy?.enabled) return 0;

  // 🔹 Ceiling blocks ONLY when esiApplicable is NOT explicitly true
  if (esiPolicy.applyCeiling !== false && esiApplicable !== true) {
    if (esiPolicy.ceiling && gross > esiPolicy.ceiling) {
      return 0;
    }
  }

  // 🔹 If esiApplicable === false → never deduct
  if (esiApplicable === false) return 0;

  let base = 0;

  if (esiPolicy.esiBasedOnEarngTotal === true) {
    // 🔵 DADRI behavior
    base = erngTotal;
  } else {
    // 🔵 all other sites
    base = resolveContributionBase(erngBaDa, erngOnDuty, esiPolicy);
  }

  if (!base || base <= 0) return 0;

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

function normalizeDesignation(desg = "") {
  return desg.toUpperCase().replace(/\./g, "").replace(/\s+/g, "");
}

function resolveOTAmount({ siteId, emp, policy, otHours, dailyWage }) {
  if (!otHours || otHours <= 0) return 0;

  const otPolicy = policy.ot;

  // ==============================
  // 🔵 DESIGNATION BASED OT
  // ==============================
  if (
    otPolicy?.type === "DESIGNATION" &&
    otPolicy.ratePerHour &&
    emp.designation
  ) {
    const norm = normalizeDesignation(emp.designation);
    const key = DESIGNATION_KEY_MAP[norm];

    if (key && otPolicy.ratePerHour[key]) {
      return otHours * Number(otPolicy.ratePerHour[key]);
    }
  }

  // ==============================
  // 🔵 DIVISOR BASED OT (DEFAULT)
  // ==============================
  const divisor = otPolicy?.divisor || 4;
  return (dailyWage / divisor) * otHours;
}

function calculateEmployeeHolidayDays({
  days,
  holidaySet,
  sundaySet,
  empAtt,
  presentDays,
}) {
  if (!presentDays || presentDays === 0) {
    return 0;
  }
  let holidayCount = 0;

  for (const date of days) {
    // must be site holiday
    if (!holidaySet.has(date)) continue;

    // skip Sundays
    if (sundaySet.has(date)) continue;

    const status = empAtt?.[date];

    // ❌ absent → no holiday
    if (status === "A") continue;

    // ✅ holiday counted in all other cases
    // H, HW, P, or even empty (default holiday)
    holidayCount++;
  }

  return holidayCount;
}

exports.previewSiteWageSheet = async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const policy = await resolveWagePolicy(siteId);

    if (!siteId || !year || !month) {
      return res.status(400).json({ message: "siteId, year, month required" });
    }

    const data = await wageService.generateSiteWageData({
      siteId,
      year,
      month,
    });

    // ✅ SAFE SUMMARY CALCULATION
    const summary = {
      totalPayout: data.rows.reduce((a, r) => a + (r.netPayable || 0), 0),
      totalDeductions: data.rows.reduce((a, r) => a + (r.dednTotal || 0), 0),
      totalCTC: data.rows.reduce((a, r) => a + (r.totalCTC || 0), 0),
    };

    // ✅ IMPORTANT — SEND RESPONSE
    return res.status(200).json({
      siteId: data.siteId,
      year: data.year,
      month: data.month,
      cycle: data.cycle,
      rows: data.rows,
      summary,
      features: {
        esiEnabled: policy?.esi?.enabled === true,
        pfEnabled: policy?.pf?.enabled === true,
      },
    });
  } catch (err) {
    console.error("Preview error:", err);
    next(err);
  }
};
