var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
const cors = require("cors");
var logger = require("morgan");
const errorHandler = require("./middlewares/errorHandler");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

var indexRouter = require("./routes/index");
var usersRouter = require("./routes/users");
const authRoutes = require("./routes/auth.route");
const attendanceRoute = require("./routes/attendance.route");

var app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://rotodyne-attendance-management-syst-two.vercel.app",
];
app.use(logger("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);
app.use(helmet());

app.use("/", indexRouter);
app.use("/users", usersRouter);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/attendance", attendanceRoute);
app.use("/api/v1/wage", require("./routes/wage.routes"));
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use(errorHandler);

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
});
app.use("/api/", generalLimiter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500).json({
    message: err.message,
    error: req.app.get("env") === "development" ? err.stack : undefined,
  });
});

module.exports = app;
