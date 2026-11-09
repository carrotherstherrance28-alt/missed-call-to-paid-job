const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const SLOT_NOTE =
  "Requested times stored by this demo. Not a calendar sync and not a confirmed appointment on an external calendar.";

export function chicagoDateISO(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function weekdayIndex(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function formatSlotLabel(iso, part) {
  const [year, month, day] = iso.split("-").map(Number);
  const stamp = new Date(Date.UTC(year, month - 1, day));
  const weekday = WEEKDAYS[stamp.getUTCDay()];
  const monthName = MONTHS[stamp.getUTCMonth()];
  const time = part === "am" ? "8:00–10:00 AM CT" : "1:00–3:00 PM CT";
  return `${weekday}, ${monthName} ${stamp.getUTCDate()} · ${time}`;
}

export function buildSlots(now = new Date(), bookedIds = []) {
  const booked = new Set(bookedIds);
  let iso = addDays(chicagoDateISO(now), 1);
  const slots = [];
  for (let guard = 0; slots.length < 8 && guard < 40; guard += 1) {
    const day = weekdayIndex(iso);
    if (day !== 0 && day !== 6) {
      for (const part of ["am", "pm"]) {
        const id = `${iso}-${part}`;
        if (!booked.has(id)) {
          slots.push({
            id,
            date: iso,
            part,
            label: formatSlotLabel(iso, part),
            available: true,
          });
        }
      }
    }
    iso = addDays(iso, 1);
  }
  return slots;
}

export function findSlot(slotId, now = new Date()) {
  const all = [];
  let iso = addDays(chicagoDateISO(now), 1);
  for (let guard = 0; all.length < 40 && guard < 40; guard += 1) {
    const day = weekdayIndex(iso);
    if (day !== 0 && day !== 6) {
      for (const part of ["am", "pm"]) {
        all.push({
          id: `${iso}-${part}`,
          date: iso,
          part,
          label: formatSlotLabel(iso, part),
        });
      }
    }
    iso = addDays(iso, 1);
  }
  return all.find((slot) => slot.id === slotId) || null;
}
