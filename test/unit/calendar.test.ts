import { describe, expect, it } from "vitest";
import { calendarFindings } from "../../src/core/detectors/calendar";
import { codes, ctx, post } from "./helpers";

const run = (text: string, dueAt: string, extra = {}) => calendarFindings(post(text, dueAt, extra), ctx());

describe("weekday and date", () => {
  it("flags a weekday that does not match its date, and proposes the right one", () => {
    const [f] = run("Join us Friday 14 November for the opening night!", "2026-11-12T18:00:00+01:00");
    expect(f?.code).toBe("weekday_date_mismatch");
    expect(f?.detail).toContain("is a Saturday, not a Friday");
    expect(f?.fix?.text).toBe("Join us Saturday 14 November for the opening night!");
  });

  it("stays silent when the weekday matches the date", () => {
    expect(run("Join us Saturday 14 November for the opening night!", "2026-11-12T18:00:00+01:00")).toEqual(
      [],
    );
  });

  it("reads month-first English dates and French dates", () => {
    expect(codes(run("Friday, November 14th: doors at 7pm", "2026-11-12T10:00:00+01:00"))).toEqual([
      "weekday_date_mismatch",
    ]);
    const [fr] = run("Rendez-vous jeudi 14 novembre à la librairie.", "2026-11-12T10:00:00+01:00");
    expect(fr?.fix?.text).toBe("Rendez-vous samedi 14 novembre à la librairie.");
  });

  it("keeps the case of the weekday it replaces", () => {
    const [f] = run("FRIDAY 14 NOVEMBER: open late", "2026-11-12T10:00:00+01:00");
    expect(f?.fix?.text).toBe("SATURDAY 14 NOVEMBER: open late");
  });

  it("uses the explicit year when one is written", () => {
    expect(run("Saturday 14 November 2026", "2026-11-12T10:00:00+01:00")).toEqual([]);
    expect(codes(run("Saturday 14 November 2027", "2026-11-12T10:00:00+01:00"))).toEqual([
      "weekday_date_mismatch",
    ]);
  });

  it("reads numeric dates day-first, and month-first for a US audience", () => {
    expect(codes(run("Friday 14/11: late opening", "2026-11-12T10:00:00+01:00"))).toEqual([
      "weekday_date_mismatch",
    ]);
    const us = calendarFindings(
      post("Friday 11/14: late opening", "2026-11-12T10:00:00-05:00", { timezone: "America/New_York" }),
      ctx({ country: "US" }),
    );
    expect(codes(us)).toEqual(["weekday_date_mismatch"]);
  });

  it("ignores impossible dates", () => {
    expect(run("Friday 31 November", "2026-11-12T10:00:00+01:00")).toEqual([]);
  });
});

describe("relative days", () => {
  it("flags 'demain' that contradicts the date written next to it, and removes the relative word", () => {
    const [f] = run("Demain, dimanche 15 novembre : on ouvre à 10h.", "2026-11-13T18:00:00+01:00");
    expect(f?.code).toBe("relative_anchor_conflict");
    expect(f?.fix?.text).toBe("Dimanche 15 novembre : on ouvre à 10h.");
  });

  it("accepts 'tomorrow' when the date agrees with the publish day", () => {
    expect(run("Tomorrow, Saturday 14 November: market day.", "2026-11-13T18:00:00+01:00")).toEqual([]);
  });

  it("checks a weekday on its own as an anchor", () => {
    expect(codes(run("Tomorrow (Monday) we open at 9.", "2026-11-13T18:00:00+01:00"))).toEqual([
      "relative_anchor_conflict",
    ]);
    expect(run("Tomorrow (Saturday) we open at 9.", "2026-11-13T18:00:00+01:00")).toEqual([]);
  });

  it("reads 'this weekend' as the coming Saturday and Sunday", () => {
    expect(run("This weekend, Sunday 15 November: brunch.", "2026-11-12T09:00:00+01:00")).toEqual([]);
    expect(codes(run("This weekend, Sunday 22 November: brunch.", "2026-11-12T09:00:00+01:00"))).toEqual([
      "relative_anchor_conflict",
    ]);
  });

  it("only compares a relative word with anchors in the same sentence", () => {
    expect(
      run("See you tomorrow! Our next market is Sunday 22 November.", "2026-11-13T18:00:00+01:00"),
    ).toEqual([]);
  });

  it("flags a relative day in a post that moved to another day since it was first seen", () => {
    const moved = run("Aujourd'hui, la boutique est ouverte toute la journée.", "2026-12-20T12:00:00+01:00", {
      firstSeenDueAt: "2026-12-19T12:00:00+01:00",
    });
    expect(codes(moved)).toEqual(["due_moved_relative_word"]);
  });

  it("does not flag a moved post without relative days, nor a first sighting", () => {
    expect(
      run("Our winter menu is here.", "2026-12-20T12:00:00+01:00", {
        firstSeenDueAt: "2026-12-19T12:00:00+01:00",
      }),
    ).toEqual([]);
    expect(run("Open today until 6pm.", "2026-12-20T12:00:00+01:00", { firstSeenDueAt: null })).toEqual([]);
  });

  it("does not flag a move within the same local day", () => {
    expect(
      run("Tonight: jazz.", "2026-12-20T18:00:00+01:00", { firstSeenDueAt: "2026-12-20T09:00:00+01:00" }),
    ).toEqual([]);
  });
});

describe("times and dates already passed", () => {
  it("flags 'tonight at 6pm' going out at 18:30, and not at 17:30", () => {
    expect(codes(run("Tonight at 6pm: live acoustic set.", "2026-11-13T18:30:00+01:00"))).toEqual([
      "time_already_passed",
    ]);
    expect(run("Tonight at 6pm: live acoustic set.", "2026-11-13T17:30:00+01:00")).toEqual([]);
  });

  it("reads a bare hour after 'tonight' as evening", () => {
    expect(codes(run("Tonight at 7, the quiz is back.", "2026-11-13T20:00:00+01:00"))).toEqual([
      "time_already_passed",
    ]);
  });

  it("reads French 24-hour times", () => {
    expect(codes(run("Ce soir à 20h : concert.", "2026-11-13T21:00:00+01:00"))).toEqual([
      "time_already_passed",
    ]);
    expect(run("Ce soir à 20h30 : concert.", "2026-11-13T20:00:00+01:00")).toEqual([]);
  });

  it("uses the latest time of a range, so opening hours are not flagged", () => {
    expect(run("Open today from 9am to 7pm.", "2026-11-13T10:00:00+01:00")).toEqual([]);
  });

  it("reads 'doors open' only when no other day is named", () => {
    expect(codes(run("Doors open at 19h.", "2026-11-13T20:00:00+01:00"))).toEqual(["time_already_passed"]);
    expect(run("Saturday: doors open at 19h.", "2026-11-13T20:00:00+01:00")).toEqual([]);
  });

  it("holds a promotion about a date already behind the publish date", () => {
    const [f] = run("Jusqu'au 1er décembre : -15 % sur tous les livres d'art.", "2026-12-03T11:00:00+01:00");
    expect(f?.code).toBe("date_already_passed");
    expect(f?.verdict).toBe("hold");
  });

  it("does not flag a past date in a past-tense sentence, nor a future date", () => {
    expect(run("On 1 December we celebrated ten years. Thank you!", "2026-12-03T11:00:00+01:00")).toEqual([]);
    expect(run("Sale ends 10 December.", "2026-12-03T11:00:00+01:00")).toEqual([]);
  });
});

describe("greetings and the hour", () => {
  it("flags 'good morning' from 18:00 and not at 17:59", () => {
    expect(codes(run("Good morning! Fresh bread.", "2026-11-13T18:00:00+01:00"))).toEqual([
      "daypart_mismatch",
    ]);
    expect(run("Good morning! Fresh bread.", "2026-11-13T17:59:00+01:00")).toEqual([]);
  });

  it("flags 'good night' before noon", () => {
    expect(codes(run("Good night, see you tomorrow.", "2026-11-13T09:00:00+01:00"))).toEqual([
      "daypart_mismatch",
    ]);
    expect(run("Good night, see you tomorrow.", "2026-11-13T22:00:00+01:00")).toEqual([]);
  });

  it("reads the hour in the channel's own timezone", () => {
    const f = calendarFindings(
      post("Good morning Sydney!", "2027-01-12T09:30:00Z", { timezone: "Australia/Sydney" }),
      ctx({ country: "AU" }),
    );
    expect(codes(f)).toEqual(["daypart_mismatch"]); // 20:30 in Sydney
  });
});

describe("links are not read as words", () => {
  it("ignores weekdays and dates inside URLs", () => {
    expect(
      run(
        "Tonight: our concert, details at https://sunday-hall.example/events/2026/11/14",
        "2026-11-12T11:00:00+01:00",
      ),
    ).toEqual([]);
  });
});
