import { ApiError } from "./error.middleware.js";

export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.slice(1).join(".")}: ${i.message}`)
      .join(", ");
    return next(new ApiError(400, message));
  }

  req.body = result.data.body ?? req.body;
  next();
};