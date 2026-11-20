export function notFoundHandler(req, res) {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(err, req, res, _next) {
  console.error('Unhandled API Error:', err);
  if (err.code === '23505') {
    return res.status(409).json({ message: 'A record with this value already exists.' });
  }
  if (err.code === '23503') {
    return res.status(400).json({
      message: 'Referenced record does not exist or is in use.',
    });
  }
  if (err.name === 'ZodError') return res.status(400).json({message:'Invalid request data',errors:err.issues.map(x=>({field:x.path.join('.'),message:x.message}))});
  const status = err.statusCode || err.status || 500;
  return res.status(status).json({ message: status >= 500 ? 'Internal server error' : (err.message || 'Request failed') });
}
