module.exports = function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return next(err);
  if (err.name === 'ValidationError') return res.status(400).json({ success: false, error: 'Invalid data supplied' });
  if (err.code === 11000) return res.status(409).json({ success: false, error: 'A record with those details already exists' });
  res.status(err.status || 500).json({ success: false, error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error') });
};
