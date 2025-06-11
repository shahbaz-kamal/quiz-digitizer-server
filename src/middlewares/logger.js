const logger = (req, res, next) => {
    console.log(
      `🔥 Request from ${req.hostname} || ${req.method} - ${
        req.url
      } - ${new Date().toLocaleTimeString()}`
    );
    next();
  };
  
  module.exports = logger;