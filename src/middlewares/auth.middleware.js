import User from "../models/User.model.js";
import Employee from "../models/Employee.model.js";
import { verifyAccessToken } from "../utils/generateToken.js";
import { ApiError, asyncHandler } from "./error.middleware.js";

export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "Not authorized, token missing");
  }

  const decoded = verifyAccessToken(header.split(" ")[1]);

  const Model = decoded.type === "employee" ? Employee : User;

  const account = await Model.findById(decoded.id);

  if (!account || account.isDeleted) {
    throw new ApiError(401, "User not found");
  }

  if (!account.isActive) {
    throw new ApiError(403, "Your account is deactivated");
  }

  req.user = account;
  next();
});