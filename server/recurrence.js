import { addDays, addWeeks, addMonths, addYears, format, parseISO } from 'date-fns';

export function nextRecurringDate(currentDate, rule) {
  if (!currentDate || !rule) return null;
  let date = parseISO(currentDate);
  const normalized = rule.trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'every day') date = addDays(date, 1);
  else if (normalized === 'weekdays' || normalized === 'every weekday') {
    do { date = addDays(date, 1); } while ([0, 6].includes(date.getDay()));
  } else if (normalized === 'weekly' || normalized === 'every week') date = addWeeks(date, 1);
  else if (normalized === 'monthly' || normalized === 'every month') date = addMonths(date, 1);
  else if (normalized === 'yearly' || normalized === 'every year') date = addYears(date, 1);
  else {
    const match = normalized.match(/^every\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)$/);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith('day')) date = addDays(date, amount);
    if (unit.startsWith('week')) date = addWeeks(date, amount);
    if (unit.startsWith('month')) date = addMonths(date, amount);
    if (unit.startsWith('year')) date = addYears(date, amount);
  }
  return format(date, 'yyyy-MM-dd');
}
