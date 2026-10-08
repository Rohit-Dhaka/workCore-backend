
export const toDateOnly = (input = new Date()) => {
  if (typeof input === "string") {
    const [y, m, d] = input.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const date = new Date(input);
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
};

export const isFutureDate = (input) => toDateOnly(input) > toDateOnly();

export const getDaysInMonth = (month, year) =>
  new Date(year, month, 0).getDate();

export const getMonthRange = (month, year) => ({
  start: new Date(Date.UTC(year, month - 1, 1)),
  end: new Date(Date.UTC(year, month, 0)),
});