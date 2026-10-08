import Employee from "../models/Employee.model.js";
import RefreshToken from "../models/RefreshToken.model.js";

import { ApiError } from "../middlewares/error.middleware.js";

import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinary.js";

import { hashPassword } from "../utils/hashPassword.js";

import {
  getPagination,
  getPaginationMeta,
} from "../utils/pagination.js";


const escapeRegex = (text) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");



const findEmployeeOrFail = async (id) => {
  const employee = await Employee.findOne({
    _id: id,
    isDeleted: false,
  }).select("+password");

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  return employee;
};



export const createEmployee = async (data, file) => {
  const {
    firstName,
    lastName,
    mobile,
    gender,
    dob,
    email,
    password,
    role,
    designation,
    basicSalary,
    remark,
  } = data;

 

  if (!firstName?.trim()) {
    throw new ApiError(400, "First name required hai");
  }

  if (!lastName?.trim()) {
    throw new ApiError(400, "Last name required hai");
  }

  if (!mobile?.trim()) {
    throw new ApiError(400, "Mobile number required hai");
  }

  if (!gender) {
    throw new ApiError(400, "Gender required hai");
  }

  if (!dob) {
    throw new ApiError(400, "Date of birth required hai");
  }

  if (!email?.trim()) {
    throw new ApiError(400, "Email required hai");
  }

  if (!password) {
    throw new ApiError(400, "Password required hai");
  }

  if (password.length < 6) {
    throw new ApiError(
      400,
      "Password minimum 6 characters ka hona chahiye"
    );
  }

  if (!designation?.trim()) {
    throw new ApiError(
      400,
      "Designation required hai"
    );
  }



  const normalizedEmail = email
    .trim()
    .toLowerCase();



  const hashedPassword =
    await hashPassword(password);



  let profileImage = {
    url: "",
    publicId: "",
  };

  if (file) {
    profileImage = await uploadToCloudinary(
      file.buffer,
      "erp/employees"
    );
  }



  try {
    const employee = await Employee.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      mobile: mobile.trim(),
      gender,
      dob,

      
      email: normalizedEmail,
      password: hashedPassword,

      role: role || "employee",

      
      designation: designation.trim(),

      basicSalary:
        basicSalary !== undefined &&
        basicSalary !== ""
          ? Number(basicSalary)
          : 0,

      remark: remark?.trim() || "",

      
      profileImage,

      isActive: true,
      isDeleted: false,
    });

    
    employee.password = undefined;

    return employee;
  } catch (error) {
   console.log(error)
  }
};


export const getEmployees = async (query = {}) => {
  const {
    page,
    limit,
    skip,
  } = getPagination(query);

  const filter = {
    isDeleted: false,
  };



  if (query.search) {
    const searchText =
      String(query.search).trim();

    if (searchText) {
      const regex = new RegExp(
        escapeRegex(searchText),
        "i"
      );

      filter.$or = [
        { firstName: regex },
        { lastName: regex },
        { mobile: regex },
        { email: regex },
        { designation: regex },
        { remark: regex },
      ];
    }
  }



  if (query.isActive !== undefined) {
    filter.isActive =
      query.isActive === "true";
  }



  if (query.role) {
    filter.role = query.role;
  }



  const [
    employees,
    total,
  ] = await Promise.all([
    Employee.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Employee.countDocuments(filter),
  ]);

  return {
    employees,
    pagination: getPaginationMeta(
      total,
      page,
      limit
    ),
  };
};


export const getEmployeeById = async (id) => {
  const employee =
    await Employee.findOne({
      _id: id,
      isDeleted: false,
    }).select("-password");

  if (!employee) {
    throw new ApiError(
      404,
      "Employee not found"
    );
  }

  return employee;
};


export const updateEmployee = async (
  id,
  data,
  file
) => {
  const employee =
    await findEmployeeOrFail(id);

  const {
    firstName,
    lastName,
    mobile,
    gender,
    dob,
    email,
    password,
    role,
    designation,
    basicSalary,
    remark,
  } = data;



  if (email?.trim()) {
    const normalizedEmail =
      email.trim().toLowerCase();

    if (
      normalizedEmail !==
      employee.email
    ) {
      const existingEmployee =
        await Employee.findOne({
          email: normalizedEmail,
          _id: { $ne: employee._id },
        });

      if (existingEmployee) {
        throw new ApiError(
          409,
          "Ye email kisi aur employee ke paas hai"
        );
      }

      employee.email =
        normalizedEmail;
    }
  }



  if (firstName !== undefined) {
    employee.firstName =
      firstName.trim();
  }

  if (lastName !== undefined) {
    employee.lastName =
      lastName.trim();
  }

  if (mobile !== undefined) {
    employee.mobile =
      mobile.trim();
  }

  if (gender !== undefined) {
    employee.gender = gender;
  }

  if (dob !== undefined) {
    employee.dob = dob;
  }



  if (role !== undefined) {
    employee.role = role;
  }

  if (designation !== undefined) {
    employee.designation =
      designation.trim();
  }

  if (basicSalary !== undefined) {
    if (basicSalary === "") {
      employee.basicSalary = 0;
    } else {
      const salary = Number(basicSalary);

      if (Number.isNaN(salary)) {
        throw new ApiError(
          400,
          "Basic salary valid number honi chahiye"
        );
      }

      if (salary < 0) {
        throw new ApiError(
          400,
          "Basic salary negative nahi ho sakti"
        );
      }

      employee.basicSalary = salary;
    }
  }

  if (remark !== undefined) {
    employee.remark =
      remark.trim();
  }



  if (password) {
    if (password.length < 6) {
      throw new ApiError(
        400,
        "Password minimum 6 characters ka hona chahiye"
      );
    }

    employee.password =
      await hashPassword(password);

    
    await RefreshToken.deleteMany({
      employee: employee._id,
    });
  }



  if (file) {
    const oldPublicId =
      employee.profileImage?.publicId;

    const newImage =
      await uploadToCloudinary(
        file.buffer,
        "erp/employees"
      );

    if (oldPublicId) {
      await deleteFromCloudinary(
        oldPublicId
      );
    }

    employee.profileImage =
      newImage;
  }


  await employee.save();

  employee.password = undefined;

  return employee;
};



export const updateEmployeeStatus = async (
  id,
  isActive,
  currentEmployeeId
) => {
  const employee =
    await findEmployeeOrFail(id);



  if (
    employee._id.toString() ===
    currentEmployeeId.toString()
  ) {
    throw new ApiError(
      400,
      "Aap apna khud ka account deactivate nahi kar sakte"
    );
  }



  if (
    typeof isActive !== "boolean"
  ) {
    throw new ApiError(
      400,
      "isActive boolean hona chahiye"
    );
  }

  employee.isActive =
    isActive;

  await employee.save();



  if (!isActive) {
    await RefreshToken.deleteMany({
      employee: employee._id,
    });
  }

  employee.password = undefined;

  return employee;
};



export const changeEmployeePassword = async (
  id,
  newPassword
) => {
  if (!newPassword) {
    throw new ApiError(
      400,
      "New password required hai"
    );
  }

  if (newPassword.length < 6) {
    throw new ApiError(
      400,
      "Password minimum 6 characters ka hona chahiye"
    );
  }

  const employee =
    await findEmployeeOrFail(id);

  employee.password =
    await hashPassword(
      newPassword
    );

  await employee.save();

  
  await RefreshToken.deleteMany({
    employee: employee._id,
  });

  return true;
};



export const deleteEmployee = async (
  id,
  currentEmployeeId
) => {
  const employee =
    await findEmployeeOrFail(id);



  if (
    employee._id.toString() ===
    currentEmployeeId.toString()
  ) {
    throw new ApiError(
      400,
      "Aap apna khud ka account delete nahi kar sakte"
    );
  }


  employee.isDeleted = true;
  employee.isActive = false;

  await employee.save();



  await RefreshToken.deleteMany({
    employee: employee._id,
  });

  return true;
};