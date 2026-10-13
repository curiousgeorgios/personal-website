// Every ISO 3166 code Stripe accepts as a shipping country (its allowed_countries list, API version 2025-09-30.clover),
// named in Australian English and lowercased (spec 16.4). The page never guesses the visitor's country.
const CODES =
  "AC AD AE AF AG AI AL AM AO AQ AR AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IS IT " +
  "JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL " +
  "NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SZ TA TC TD TF TG TH TJ " +
  "TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VN VU WF WS XK YE YT ZA ZM ZW";

export const COUNTRY_CODES: ReadonlySet<string> = new Set(CODES.split(" "));

// Built on first use, not at import: most pages that import this never name a country
let names: Intl.DisplayNames | undefined;

export function countryName(code: string): string {
  names ??= new Intl.DisplayNames("en-AU", { type: "region" });
  return (names.of(code) ?? code).toLowerCase();
}

/** [code, name] for the country select, sorted by name */
export function countryOptions(): [string, string][] {
  const collator = new Intl.Collator("en-AU");
  return [...COUNTRY_CODES].map((code): [string, string] => [code, countryName(code)]).sort((a, b) => collator.compare(a[1], b[1]));
}
