import Employee from "../models/Employee.model.js";
import { ApiError } from "../middlewares/error.middleware.js";
import mongoose from "mongoose";
import { hashPassword } from "../utils/hashPassword.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";



export const createEmployee = async (req, res) => {
  
  if (!req.user || req.user.role !== "admin") {
    throw new ApiError(403, "Only admin can create employee");
  }

  const {
    firstName,
    lastName,
    mobile,
    gender,
    dob,
    email,
    password,
    designation,
    basicSalary,
    remark,
  } = req.body;

  
  if (
    !firstName ||
    !lastName ||
    !mobile ||
    !gender ||
    !dob ||
    !email ||
    !password ||
    !designation
  ) {
    throw new ApiError(400, "All fields are required");
  }

  const normalizedEmail = email.trim().toLowerCase();

  
  const existingEmployee = await Employee.findOne({
    email: normalizedEmail,
  });

  if (existingEmployee) {
    throw new ApiError(
      409,
      "Employee with this email already exists"
    );
  }
  
  let profileImage = { url: "", publicId: "" };

  if (req.file) {
    profileImage = await uploadToCloudinary(req.file.buffer);
  }

  
  const employee = await Employee.create({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    mobile: mobile.trim(),
    gender,
    dob,
    email: normalizedEmail,
    password: await hashPassword(password),
    role: "employee",

    profileImage,

    designation: designation.trim(),

    basicSalary: basicSalary ? Number(basicSalary) : 0,

    remark: remark?.trim() || "",

    isActive: true,
    isDeleted: false,
  });

  res.status(201).json({
    success: true,
    message: "Employee created successfully",

    employee: {
      _id: employee._id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      mobile: employee.mobile,
      gender: employee.gender,
      dob: employee.dob,
      email: employee.email,
      role: employee.role,
      profileImage: employee.profileImage,
      designation: employee.designation,
      basicSalary: employee.basicSalary,
      remark: employee.remark,
      isActive: employee.isActive,
    },
  });
};


const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid employee id");
  }
};


export const getEmployees = async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const { search, status } = req.query;

  const filter = { isDeleted: false, role: "employee" };

  if (status === "active") filter.isActive = true;
  if (status === "inactive") filter.isActive = false;

  if (search) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { mobile: regex },
      { designation: regex },
    ];
  }

  const [employees, total] = await Promise.all([
    Employee.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Employee.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    employees,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
};


export const getEmployeeById = async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const employee = await Employee.findOne({ _id: id, isDeleted: false });

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  res.status(200).json({ success: true, employee });
};


export const updateEmployee = async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const employee = await Employee.findOne({ _id: id, isDeleted: false });

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  const {
    firstName,
    lastName,
    mobile,
    gender,
    dob,
    email,
    designation,
    basicSalary,
    remark,
  } = req.body;

  if (email) {
    const normalizedEmail = email.trim().toLowerCase();

    const emailExists = await Employee.findOne({
      email: normalizedEmail,
      _id: { $ne: id },
    });

    if (emailExists) {
      throw new ApiError(409, "Employee with this email already exists");
    }

    employee.email = normalizedEmail;
  }

  if (firstName) employee.firstName = firstName.trim();
  if (lastName) employee.lastName = lastName.trim();
  if (mobile) employee.mobile = mobile.trim();
  if (gender) employee.gender = gender;
  if (dob) employee.dob = dob;
  if (designation) employee.designation = designation.trim();
  if (basicSalary !== undefined && basicSalary !== "") {
    employee.basicSalary = Number(basicSalary);
  }
  if (remark !== undefined) employee.remark = remark.trim();

  
  let oldPublicId = "";
  if (req.file) {
    oldPublicId = employee.profileImage?.publicId;
    employee.profileImage = await uploadToCloudinary(req.file.buffer);
  }

  await employee.save();

  
  if (oldPublicId) {
    await deleteFromCloudinary(oldPublicId);
  }

  res.status(200).json({
    success: true,
    message: "Employee updated successfully",
    employee,
  });
};


export const toggleEmployeeStatus = async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const employee = await Employee.findOne({ _id: id, isDeleted: false });

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  employee.isActive = !employee.isActive;
  await employee.save();

  res.status(200).json({
    success: true,
    message: `Employee ${employee.isActive ? "activated" : "deactivated"} successfully`,
    employee,
  });
};


export const deleteEmployee = async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const employee = await Employee.findOne({ _id: id, isDeleted: false });

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  employee.isDeleted = true;
  employee.isActive = false;
  await employee.save();

  res.status(200).json({
    success: true,
    message: "Employee deleted successfully",
  });
};


export const changeEmployeePassword = async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  checkId(id);

  if (!newPassword || newPassword.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters");
  }

  const employee = await Employee.findOne({ _id: id, isDeleted: false });

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  employee.password = await hashPassword(newPassword);
  await employee.save();

  res.status(200).json({
    success: true,
    message: "Password changed successfully",
  });
};