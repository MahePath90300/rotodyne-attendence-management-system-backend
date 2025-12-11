// src/controllers/wage.controller.js
const ExcelJS = require("exceljs");
const { addDays, format } = require("date-fns");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Holiday = require("../models/Holiday");

// ---- wage constants ----
const DAILY_WAGE_BY_CAT = {
  HSW: 893,
  SW: 760,
  SSW: 632,
  USW: 541,
};

// Keep headers as you had (adjust if you want to rename)
const WAGE_HEADERS = [
  "Sl no", // 1
  "Month numbr", // 2
  "Emp no", // 3
  "Name", // 4
  "Dsg", // 5
  "Cat", // 6
  "Manpwr Typ", // 7
  "Gross", // 8
  "v%", // 9
  "Daily Minw", // 10
  "Total days", //11 (totalWorkDays)
  "Prsnt Days", //12 (PP + P + HW)
  "Abs days", //13 (AA + A)
  "CL day", //14 (CC)
  "Coff Days", //15 (kept 0 for now)
  "Holidays", //16 (HH count)
  "Paid Days", //17 (presentDays + WW + CC)
  "Site days", //18 (kept 0 placeholder)
  "Emg ba+da", //19 (removed detailed calc, keep 0)
  "EmAda", //20
  "Emg HRA", //21
  "Emg Conv", //22
  "Emg Med", //23
  "Emg Sub Tot", //24
  "Emg onBas", //25
  "Emg onDy", //26
  "Emg Sub Tot", //27
  "EMg SitDa", //28
  "OT hrs", //29
  "Earng OTamt", //30
  "Emg othPy", //31
  "Emg Arrear", //32
  "Emg total", //33 (emgTotal)
  "PF pay", //34 (12% of gross)
  "Esi pay", //35 (2% of gross)
  "dedn EPF", //36 (12% on paid days)
  "dedn ESI", //37 (2% on paid days)
  "Ded Lon", //38
  "Ded TDS", //39
  "Ded Adv", //40
  "Ded ptax", //41 (not calculated)
  "Ded oth", //42
  "Dedn total", //43
  "Net payable", //44
];

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
      return res.status(403).json({ message: "Only admin can export wage sheet" });
    }

    const { start, end, days } = buildMonthWindow(year, month);

    // 1) employees of this site sorted by name
    const employees = await Employee.find({ site: siteId })
      .sort({ name: 1 })
      .lean();

    if (!employees.length) {
      return res.status(404).json({ message: "No employees for this site" });
    }

    // 2) attendance in that window
    const attDocs = await Attendance.find({
      siteId,
      date: { $gte: start, $lte: end },
    }).lean();

    // Build two maps: status by emp and ot by emp
    const attByEmp = {};
    const otByEmp = {};
    for (const doc of attDocs) {
      if (!attByEmp[doc.empNo]) attByEmp[doc.empNo] = {};
      if (!otByEmp[doc.empNo]) otByEmp[doc.empNo] = {};
      if (doc.status) attByEmp[doc.empNo][doc.date] = doc.status;
      // store otHours if present (may be 0)
      if (typeof doc.otHours !== "undefined" && doc.otHours !== null) {
        otByEmp[doc.empNo][doc.date] = Number(doc.otHours) || 0;
      }
    }

    // 3) holidays for this site (use holiday collection 'site' field)
    const holidayDocs = await Holiday.find({
      site: siteId,
      date: { $gte: start, $lte: end },
    }).lean();

    const holidaySet = new Set(holidayDocs.map((h) => h.date));

    // 4) Sundays in that window
    const sundaySet = new Set(days.filter((iso) => new Date(iso).getDay() === 0));

    // 5) build workbook
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Wage Sheet", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    // header row
    ws.addRow(WAGE_HEADERS);
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, size: 10 };
    headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    headerRow.height = 28;

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // column widths (preserve your previous choices)
    const colWidths = [
      6, 10, 10, 28, 14, 10, 12, 12, 6, 10,
      10, 10, 10, 8, 10, 10, 10, 8, 10, 10,
      10, 10, 10, 10, 10, 10, 10, 10, 8, 12,
      10, 10, 12, 10, 10, 10, 10, 10, 10, 10,
      10, 12, 12
    ];
    ws.columns = colWidths.map((w) => ({ width: w }));

    let sl = 1;

    for (const emp of employees) {
      const cat = (emp.category || "").toUpperCase();
      const dailyWage = DAILY_WAGE_BY_CAT[cat] || 0;

      // counters
      let presentDays = 0; // PP=1, P=0.5, HW counted below as present
      let absentDays = 0; // AA=1, A=0.5
      let clDays = 0; // CC
      let coffDays = 0; // currently unused (0)
      let weekOffDays = 0; // WW
      let holidayWorkDays = 0; // HW
      let hhCount = 0; // HH (holiday/sunday not worked)
      let otHours = 0;
      let hwCount = 0; // HW count
      let hhOnlyCount = 0; // HH only
      let totalHolidays = 0; // count of days that are holidays/sundays (for sheet)

      const empAtt = attByEmp[emp.empNo] || {};
      const empOt = otByEmp[emp.empNo] || {};

      for (const iso of days) {
        const status = empAtt[iso] || "";
        const isSunday = sundaySet.has(iso);
        const isHoliday = holidaySet.has(iso);
        const isHolidayOrSunday = isHoliday || isSunday;

        // OT for this day (may be undefined)
        const dayOt = typeof empOt[iso] !== "undefined" ? Number(empOt[iso]) : 0;
        otHours += dayOt;

        // status processing
        if (status === "PP") presentDays += 1;
        else if (status === "P") presentDays += 0.5;
        else if (status === "AA") absentDays += 1;
        else if (status === "A") absentDays += 0.5;
        else if (status === "CC") clDays += 1;
        else if (status === "WW") weekOffDays += 1;
        else if (status === "HW") {
          // Treat HW as a present day and holiday-work count
          presentDays += 1;
          holidayWorkDays += 1;
          hwCount += 1;
        } else if (status === "HH") {
          // explicit holiday not worked
          hhOnlyCount += 1;
        }

        // HH counting: per your earlier description, HH should count Sundays+public-holidays that worker did NOT convert to HW
        if (isHolidayOrSunday) {
          totalHolidays += 1;
          if (status !== "HW") {
            hhCount += 1;
          }
        }
      }

      // Following your formula:
      // totalWorkDays = days.length - HH + HW
      const totalWorkDays = days.length - hhCount + hwCount;

      // paidDays = presentDays + weekOffDays + clDays (per your instruction)
      const paidDays = presentDays + weekOffDays + clDays;

      // OT earnings
      // You used dailyWage/4 previously as OT per hour — keep that unless you want a different multiplier.
      const otRatePerHour = dailyWage / 4;
      const otAmount = otHours * otRatePerHour;

      // gross = dailyWage * totalWorkDays (per screenshot sample)
      const gross = dailyWage * totalWorkDays;

      // Employer contributions (columns you asked to show)
      const pfPay = Number((gross * 0.12).toFixed(2)); // 12% of gross
      const esiPay = Number((gross * 0.02).toFixed(2)); // 2% of gross

      // Deductions based on paid days (without OT)
      const dednEPF = Number((dailyWage * paidDays * 0.12).toFixed(2)); // 12% on paid days
      const dednESI = Number((dailyWage * paidDays * 0.02).toFixed(2)); // 2% on paid days

      const dedPtax = 0; // per your instruction: do not compute PTAX for now

      // Sum up deductions (other deduction columns left 0)
      const dedLon = 0;
      const dedTds = 0;
      const dedAdv = 0;
      const dedOth = 0;

      const dednTotal = Number(
        (
          dednEPF +
          dednESI +
          dedLon +
          dedTds +
          dedAdv +
          dedPtax +
          dedOth
        ).toFixed(2)
      );

      // Emg total = earning from paid days (paidDays * dailyWage) + OT earnings
      const emgOnPaidDays = Number((dailyWage * paidDays).toFixed(2));
      const emgTotal = Number((emgOnPaidDays + otAmount).toFixed(2));

      const netPayable = Number((emgTotal - dednTotal).toFixed(2));

      // Build row (exact order of headers)
      const rowValues = [
        sl, // Sl no
        month, // Month numbr
        emp.empNo || "", // Emp no
        emp.name || "", // Name
        emp.designation || "", // Dsg
        emp.category || "", // Cat
        (emp.manpowerType || emp.siteType || "") || "", // Manpwr Typ
        gross, // Gross
        0, // v%
        dailyWage, // Daily Minw
        totalWorkDays, // Total days
        presentDays, // Prsnt Days (PP+P+HW)
        absentDays, // Abs days
        clDays, // CL day
        coffDays, // Coff Days
        hhCount, // Holidays (HH count)
        paidDays, // Paid Days
        0, // Site days (placeholder)
        0, // Emg ba+da
        0, // EmAda
        0, // Emg HRA
        0, // Emg Conv
        0, // Emg Med
        0, // Emg Sub Tot
        0, // Emg onBas
        0, // Emg onDy
        0, // Emg Sub Tot
        0, // EMg SitDa
        otHours, // OT hrs
        otAmount, // Earng OTamt
        0, // Emg othPy
        0, // Emg Arrear
        emgTotal, // Emg total
        pfPay, // PF pay (12% of gross)
        esiPay, // Esi pay (2% of gross)
        dednEPF, // dedn EPF (12% on paid days)
        dednESI, // dedn ESI (2% on paid days)
        dedLon, // Ded Lon
        dedTds, // Ded TDS
        dedAdv, // Ded Adv
        dedPtax, // Ded ptax (0 for now)
        dedOth, // Ded oth
        dednTotal, // Dedn total
        netPayable, // Net payable
      ];

      const newRow = ws.addRow(rowValues);

      // cell formatting and borders
      newRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // center small numeric columns
        cell.alignment = { vertical: "middle", horizontal: colNumber === 4 ? "left" : "center" };

        // currency formatting for selected columns
        const currencyCols = new Set([8, 10, 30, 33, 34, 35, 36, 37, 41, 42, 44]); // you may tweak
        if (currencyCols.has(colNumber) && typeof cell.value === "number") {
          cell.numFmt = '#,##0.00';
        }

        cell.border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
      });

      // Highlight rows / cells where OT hours > 0:
      // if (otHours > 0) {
      //   // highlight OT hrs cell (29) and OT amount cell (30)
      //   const otCell = newRow.getCell(29);
      //   const otAmtCell = newRow.getCell(30);
      //   const fill = {
      //     type: "pattern",
      //     pattern: "solid",
      //     fgColor: { argb: "FFFFF2CC" }, // light yellow highlight
      //   };
      //   otCell.fill = fill;
      //   otAmtCell.fill = fill;
      // }

      // alternate row fill for readability
      if (sl % 2 === 0) {
        newRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFB" },
          };
        });
      }

      sl += 1;
    }

    const fileName = `wage_sheet_${siteId}_${year}_${month}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};
