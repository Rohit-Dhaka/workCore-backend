import jwt from "jsonwebtoken";

import User from "../models/User.model.js";
import Employee from "../models/Employee.model.js";
import { asyncHandler, ApiError } from "../middlewares/error.middleware.js";
import { comparePassword, hashPassword } from "../utils/hashPassword.js";
import { ROLES } from "../types/auth.types.js";
import env from "../config/env.js";


const SAFE_FIELDS =
  "-password -refreshToken -resetPasswordOTP -resetPasswordOTPExpires";

const generateAccessToken = (account, type) => {
  if (!env.JWT_ACCESS_SECRET) {
    throw new ApiError(500, "JWT_ACCESS_SECRET .env mein missing hai");
  }

  return jwt.sign(
    {
      id: account._id,
      role: account.role,
      type, 
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "7d" }
  );
};



export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email?.trim()) {
    throw new ApiError(400, "Email required hai");
  }

  if (!password) {
    throw new ApiError(400, "Password required hai");
  }

  const normalizedEmail = email.trim().toLowerCase();

  
  let account = await User.findOne({
    email: normalizedEmail,
    isDeleted: false,
  }).select("+password");

  let type = "user";

  
  if (!account) {
    account = await Employee.findOne({
      email: normalizedEmail,
      isDeleted: false,
    }).select("+password");

    type = "employee";
  }

  if (!account) {
    throw new ApiError(401, "Invalid email ya password");
  }

  if (!account.isActive) {
    throw new ApiError(403, "Account inactive hai");
  }

  const passwordMatch = await comparePassword(password, account.password);

  if (!passwordMatch) {
    throw new ApiError(401, "Invalid email ya password");
  }

  const accessToken = generateAccessToken(account, type);

  account.password = undefined;

  res.status(200).json({
    success: true,
    message: "Login successful",
    user: account,
    accessToken,
  });
});


export const getAdminProfile = async (req, res) => {
  try {
    const admin = await User.findOne({
      _id: req.user._id,
      role: ROLES.ADMIN,
      isDeleted: false,
    }).select(SAFE_FIELDS);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Admin profile fetched successfully",
      data: admin,
    });
  } catch (error) {
    console.error("GET ADMIN PROFILE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin profile",
    });
  }
};



export const updateAdminProfile = async (req, res) => {
  try {
    const { firstName, lastName, mobile, gender, dob } = req.body;

    const admin = await User.findOne({
      _id: req.user._id,
      role: ROLES.ADMIN,
      isDeleted: false,
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found",
      });
    }

    if (firstName !== undefined) {
      const value = String(firstName).trim();

      if (!value) {
        return res.status(400).json({
          success: false,
          message: "First name required hai",
        });
      }

      admin.firstName = value;
    }

    if (lastName !== undefined) {
      admin.lastName = String(lastName).trim();
    }

    if (mobile !== undefined) {
      const value = String(mobile).trim();
      const digits = value.replace(/\D/g, "");

      if (value && (digits.length < 10 || digits.length > 15)) {
        return res.status(400).json({
          success: false,
          message: "Mobile number sahi nahi hai",
        });
      }

      admin.mobile = value;
    }

    if (gender !== undefined) {
      if (!["male", "female", "other", ""].includes(gender)) {
        return res.status(400).json({
          success: false,
          message: "Gender sahi nahi hai",
        });
      }

      admin.gender = gender;
    }

    if (dob !== undefined) {
      if (!dob) {
        admin.dob = null;
      } else {
        const date = new Date(dob);

        if (Number.isNaN(date.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Date of birth sahi nahi hai",
          });
        }

        admin.dob = date;
      }
    }

    await admin.save();

    const updatedAdmin = await User.findById(admin._id).select(SAFE_FIELDS);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedAdmin,
    });
  } catch (error) {
    console.error("UPDATE ADMIN PROFILE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};


export const changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Current password, new password and confirm password are required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New password and confirm password do not match",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters",
      });
    }

    
    const admin = await User.findOne({
      _id: req.user._id,
      role: ROLES.ADMIN,
      isDeleted: false,
    }).select("+password");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found",
      });
    }

    const isPasswordCorrect = await comparePassword(
      currentPassword,
      admin.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const isSamePassword = await comparePassword(newPassword, admin.password);

    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    admin.password = await hashPassword(newPassword);

    await admin.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully. Please login again.",
    });
  } catch (error) {
    console.error("CHANGE ADMIN PASSWORD ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  }
};