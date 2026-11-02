/**
 * Words that make a Title Case phrase a control label, heading or field name
 * rather than a person: "Contact Support", "Submit Payment", "Duty Roster".
 * Shared by element-text.ts (scrubbing DOM control text) and names.ts (the
 * label-anchored OCR name heuristic). Deliberately generous on the side of NOT
 * calling something a name; callers decide how strictly to use it (a phrase is
 * only dropped when it is made of these words, so a surname that happens to
 * match one, like "Field" or "Page", still works next to a real first name).
 */
export const NON_NAME_WORDS: ReadonlySet<string> = new Set((
  "sign signed log login logout logged submit open close save cancel search next back previous continue download upload report reports " +
  "payment payments pay account accounts settings setting profile home help contact support menu dashboard order orders cart checkout view edit " +
  "delete add new create send message messages inbox notifications notification privacy policy terms conditions about pricing features products " +
  "services docs documentation status summary details overview history duty roster telemetry station operator password username email phone " +
  "address field value name first last page pages more less all none yes ok done apply reset refresh filter sort select files file folder share " +
  "copy paste print export import faq news blog careers team company quarterly annual monthly daily weekly forgot remember show hide toggle " +
  "read write list table chart graph map calendar date time today tomorrow start stop run pause resume play enable disable update upgrade " +
  "install remove manage admin user users guest public private secure security verify confirm review approve reject accept decline request " +
  "invoice billing plan subscription center learn get started explore browse compare buy sell shop store cookie cookies " +
  "dismiss skip finish complete step wizard form input button link tab section panel modal dialog window toolbar sidebar footer header us sales info"
).split(/\s+/));

export const isNonNameWord = (token: string): boolean => NON_NAME_WORDS.has(token.replace(/[^A-Za-z]/g, "").toLowerCase());
