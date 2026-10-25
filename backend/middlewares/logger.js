module.exports = (req, res, next) => {
  const debut = Date.now();
  res.on('finish', () => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - debut}ms)`
    );
  });
  next();
};