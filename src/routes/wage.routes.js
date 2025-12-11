const express = require("express");
const router = express.Router();
const  authMiddleware = require("../middlewares/authMiddleware");
const wageController = require("../controllers/wage.controller");

router.get(
  "/site/:siteId/export",
  authMiddleware,
  wageController.exportSiteWageSheet
);

module.exports = router;
