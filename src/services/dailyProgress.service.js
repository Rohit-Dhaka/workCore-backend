import DailyProgress from "../models/dailyProgress.model.js";

const getStartOfDay = (date = new Date()) => {
  const start = new Date(date);

  start.setHours(0, 0, 0, 0);

  return start;
};

const getEndOfDay = (date = new Date()) => {
  const end = new Date(date);

  end.setHours(23, 59, 59, 999);

  return end;
};

export const getTodayProgressService = async (
  employeeId
) => {
  const start = getStartOfDay();
  const end = getEndOfDay();

  return await DailyProgress.findOne({
    employee: employeeId,
    date: {
      $gte: start,
      $lte: end,
    },
  }).populate(
    "employee",
    "firstName lastName email designation"
  );
};

export const getOrCreateTodayProgressService = async (
  employeeId
) => {
  const start = getStartOfDay();

  let progress = await DailyProgress.findOne({
    employee: employeeId,
    date: start,
  });

  if (!progress) {
    progress = await DailyProgress.create({
      employee: employeeId,
      date: start,
      status: "draft",
    });
  }

  return progress;
};

export const getWeeklyProgressService = async (
  employeeId,
  startDate,
  endDate
) => {
  const start = getStartOfDay(
    startDate || new Date()
  );

  const end = getEndOfDay(
    endDate || new Date()
  );

  return await DailyProgress.find({
    employee: employeeId,
    date: {
      $gte: start,
      $lte: end,
    },
  })
    .sort({ date: 1 })
    .populate(
      "employee",
      "firstName lastName email designation"
    );
};

export const getAllProgressService = async ({
  employee,
  startDate,
  endDate,
  status,
}) => {
  const filter = {};

  if (employee) {
    filter.employee = employee;
  }

  if (status) {
    filter.status = status;
  }

  if (startDate || endDate) {
    filter.date = {};

    if (startDate) {
      filter.date.$gte = getStartOfDay(startDate);
    }

    if (endDate) {
      filter.date.$lte = getEndOfDay(endDate);
    }
  }

return DailyProgress.find(filter)
  .populate("employee", "firstName lastName email designation profileImage")
  .sort({ date: -1 });
};