import { z } from "zod";
import { GENDERS } from "../types/employee.types.js";
import { ROLES } from "../types/auth.types.js";

const roleEnum = z.enum(Object.values(ROLES));
const genderEnum = z.enum(GENDERS);

export const createEmployeeSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1, "First name zaroori hai"),
    lastName: z.string().trim().min(1, "Last name zaroori hai"),
    mobile: z.string().trim().min(10, "Mobile number sahi do"),
    gender: genderEnum,
    dob: z.coerce.date(),
    email: z.string().email("Valid email do").toLowerCase(),
    password: z.string().min(6, "Password kam se kam 6 character ka ho"),
    role: roleEnum.default(ROLES.EMPLOYEE),
    designation: z.string().trim().min(1, "Designation zaroori hai"),
    monthlySalary: z.coerce.number().min(0).default(0),
    joiningDate: z.coerce.date().optional(),
  }),
});

export const updateEmployeeSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    mobile: z.string().trim().min(10).optional(),
    gender: genderEnum.optional(),
    dob: z.coerce.date().optional(),
    email: z.string().email().toLowerCase().optional(),
    role: roleEnum.optional(),
    designation: z.string().trim().min(1).optional(),
    monthlySalary: z.coerce.number().min(0).optional(),
    joiningDate: z.coerce.date().optional(),
  }),
});

export const statusSchema = z.object({
  body: z.object({
    isActive: z.boolean({ message: "isActive true ya false hona chahiye" }),
  }),
});

export const passwordSchema = z.object({
  body: z.object({
    newPassword: z.string().min(6, "Password kam se kam 6 character ka ho"),
  }),
});