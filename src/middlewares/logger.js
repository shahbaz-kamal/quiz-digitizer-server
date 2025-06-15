const logger = (req, res, next) => {
  if (req.url === "/favicon.ico") return next();
    console.log(
      `🔥 Request from ${req.hostname} || ${req.method} - ${
        req.url
      } - ${new Date().toLocaleTimeString()}`
    );
    next();
  };
  
  module.exports = logger;