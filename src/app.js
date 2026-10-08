import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import env from "./config/env.js";
import { notFound, errorHandler } from "./middlewares/error.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import employeeRoutes from "./routes/employee.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import ledgerRoutes from "./routes/ledger.routes.js";
import supportTicketRoutes from "./routes/supportTicket.routes.js";
import leaveRoutes from "./routes/leave.routes.js";
import payrollRoutes from "./routes/payroll.routes.js";
import meRoutes from "./routes/me.routes.js";
import announcementRoutes from "./routes/announcement.routes.js";
import expenseRoutes from "./routes/expense.routes.js";
import dailyProgressRoutes from "./routes/dailyProgress.routes.js";
import assetRoutes from "./routes/asset.routes.js";
import performanceRoutes from "./routes/performance.routes.js";
import calendarRoutes from "./routes/calendar.routes.js";
import quotationRoutes  from './routes/quotation.routes.js'
import manufacturingRoutes from './routes/manufacturing.routes.js'
import crmRoutes from "./routes/crm.routes.js";





const app = express();

app.use(helmet());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/ledger", ledgerRoutes);
app.use("/api/helpdesk",supportTicketRoutes,);
app.use("/api/leaves", leaveRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/me", meRoutes);
app.use("/api/announcements",announcementRoutes)
app.use("/api/expenses", expenseRoutes);
app.use("/api/daily-progress",dailyProgressRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/quotations" , quotationRoutes)
app.use('/api/manufacturing', manufacturingRoutes);
app.use("/api/crm", crmRoutes);




app.use(notFound);
app.use(errorHandler);

if (env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}


app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "ERP API is running" });
});


app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

export default app;