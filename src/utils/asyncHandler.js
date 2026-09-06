/**
 * Express 4 does not automatically forward rejected promises from async
 * route handlers to the error-handling middleware — an unhandled
 * rejection there just hangs the request or crashes the process. Wrap
 * every async controller with this so `throw`/rejected promises reach
 * app.js's centralized error handler.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
