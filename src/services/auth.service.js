import crypto from "crypto";
import jwt from "jsonwebtoken";
import env from "../config/env.js";
import User from "../models/User.model.js";
import Employee from "../models/Employee.model.js";
import RefreshToken from "../models/RefreshToken.model.js";
import { ROLES } from "../types/auth.types.js";
import { ApiError } from "../middlewares/error.middleware.js";
import { hashPassword, comparePassword } from "../utils/hashPassword.js";
import {
  generateAccessToken,
  verifyRefreshToken,
} from "../utils/generateToken.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createSession = async (user) => {
  const payload = { id: user._id, role: user.role };
  const accessToken = generateAccessToken(payload);


  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(jwt.decode(refreshToken).exp * 1000),
  });

  return { accessToken, refreshToken };
};

export const loginUser = async ({ email, password }) => {
  console.log("LOGIN EMAIL:", email);
  console.log("PASSWORD RECEIVED:", password ? "YES" : "NO");

  const user = await User.findOne({
    email,
    isDeleted: false,
  }).select("+password");

  console.log("USER FOUND:", !!user);

  if (user) {
    console.log("DB EMAIL:", user.email);
    console.log("DB PASSWORD HASH EXISTS:", !!user.password);

    const passwordMatch = await comparePassword(
      password,
      user.password
    );

    console.log("PASSWORD MATCH:", passwordMatch);
  }

  if (!user || !(await comparePassword(password, user.password))) {
    throw new ApiError(401, "Invalid email or password");
  }

  if (!user.isActive) {
    throw new ApiError(
      403,
      "Your account is deactivated. Admin se contact karo."
    );
  }

  const tokens = await createSession(user);

  return {
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    ...tokens,
  };
};

export const refreshSession = async (oldToken) => {
  if (!oldToken) throw new ApiError(401, "Refresh token missing");

  const decoded = verifyRefreshToken(oldToken);
  const stored = await RefreshToken.findOneAndDelete({
    tokenHash: hashToken(oldToken),
  });
  if (!stored) throw new ApiError(401, "Refresh token invalid");

  const user = await User.findById(decoded.id);
  if (!user || user.isDeleted) throw new ApiError(401, "User not found");
  if (!user.isActive) throw new ApiError(403, "Your account is deactivated");

  return createSession(user);
};


export const getProfile = async (userId) => {
  const user = await User.findById(userId);
  const employee = await Employee.findOne({ user: userId });
  return { user, employee };
};


export const seedAdmin = async () => {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.log("ADMIN_EMAIL / ADMIN_PASSWORD .env mein nahi mila");
    return;
  }

  const email = env.ADMIN_EMAIL.toLowerCase().trim();
  const password = await hashPassword(env.ADMIN_PASSWORD);

  const admin = await User.findOne({ role: ROLES.ADMIN });

  if (admin) {
    admin.email = email;
    admin.password = password;
    admin.isActive = true;
    admin.isDeleted = false;
    await admin.save();
    console.log("Admin updated from .env:", email);
    return;
  }

  await User.create({ email, password, role: ROLES.ADMIN });
  console.log("Admin created:", email);
};