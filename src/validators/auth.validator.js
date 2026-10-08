import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Valid email do"),
    password: z.string().min(6, "Password kam se kam 6 character ka ho"),
  }),
});