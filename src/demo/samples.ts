// "Add sample drafts": five drafts written so that each check has something to find, linked to the demo
// shop and venue. They are created with saveToDraft, so they never publish on their own.
import { addDays, localParts, localToInstant, weekdayOf, WEEKDAY_NAMES_EN, MONTH_NAMES_EN, parseDateKey } from "../core/time";

export interface SampleDraft {
  text: string;
  dueAt: string;
  expect: string;
}

export function sampleDrafts(origin: string, timeZone: string, now: number): SampleDraft[] {
  const today = localParts(now, timeZone).date;
  const tomorrow = addDays(today, 1);
  const inTwo = addDays(today, 2);
  const at = (date: string, hour: number, minute = 0): string => localToInstant(date, hour, minute, timeZone).toISOString();

  // A date four days out, announced with the weekday of the day before it: the mismatch is real.
  const eventDay = addDays(today, 4);
  const wrongWeekday = WEEKDAY_NAMES_EN[((weekdayOf(eventDay) + 5) % 7)] as string;
  const { day, month } = parseDateKey(eventDay);

  return [
    {
      text: `Back in stock: our natural linen shirt, €49. Grab yours before the weekend ${origin}/demo/shop/linen-shirt`,
      dueAt: at(tomorrow, 10),
      expect: "out_of_stock",
    },
    {
      text: `New this week: rust wool scarves, knitted in Alsace, €49 each 🧣 ${origin}/demo/shop/wool-scarf`,
      dueAt: at(tomorrow, 12, 30),
      expect: "price_changed",
    },
    {
      text: `Jazz night at Salle Rivage, three days from now. Doors at 19:30, tickets here ${origin}/demo/events/jazz-night`,
      dueAt: at(tomorrow, 17),
      expect: "event_postponed",
    },
    {
      text: `Open studio on ${wrongWeekday} ${day} ${MONTH_NAMES_EN[month - 1]}: meet the makers, free entry. ${origin}/demo/events/open-studio`,
      dueAt: at(inTwo, 9),
      expect: "weekday_date_mismatch",
    },
    {
      text: "Good morning! The first croissants are out of the oven ☕",
      dueAt: at(inTwo, 20, 30),
      expect: "daypart_mismatch",
    },
  ];
}
