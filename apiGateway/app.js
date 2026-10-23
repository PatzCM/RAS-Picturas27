var createError = require("http-errors");
var express = require("express");
var cors = require("cors"); // Import cors
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
var projectsRouter = require("./routes/projects");
var usersRouter = require("./routes/users");
var subscriptionsRouter = require("./routes/subscriptions");
var app = express();

// Enable CORS for all routes
app.use(cors());

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/projects", projectsRouter);
app.use("/users", usersRouter);
app.use("/subscriptions", subscriptionsRouter);

// Compatibilidade T-01: Encaminhamento de /user/project/video/* para o router de projects
app.use("/user/project/video", function (req, res, next) {
  req.url = `/user/project/video${req.url}`;
  return projectsRouter(req, res, next);
});

// Compatibilidade Anexo A.7: POST /auth/login
app.post("/auth/login", function (req, res, next) {
  const email = req.body.email || req.body.username || "teste";
  req.url = `/${encodeURIComponent(email)}/login`;
  return usersRouter(req, res, next);
});

// Compatibilidade Anexo A.7: POST /storage/presigned-url
app.post("/storage/presigned-url", async function (req, res, next) {
  try {
    const axios = require("axios");
    const userId = req.body.userId || "user";
    const projectId = req.body.projectId || "project";
    const fileName = req.body.fileName || `sample_${Date.now()}.mp4`;
    const contentType = req.body.contentType || "video/mp4";
    const stage = req.body.stage || "src";
    const resp = await axios.get(
      `http://img_storage:11000/upload/presigned/public/${userId}/${projectId}/${stage}/${fileName}`,
      { params: { contentType } }
    );
    return res.status(200).jsonp(resp.data);
  } catch (err) {
    return res.status(err.response?.status || 500).jsonp(err.response?.data || { error: "Failed to generate presigned url" });
  }
});

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
  res.status(err.status || 500).jsonp(err);
});

module.exports = app;
