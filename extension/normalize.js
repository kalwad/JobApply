(() => {
  'use strict';

  if (window.__cpNormalize) return;

  // ─── Lookup Tables ──────────────────────────────────────────
  // Each table is an array of synonym groups. Every value within a group
  // is considered equivalent. The first value is the canonical form
  // (stored lowercase internally). Lookups are case-insensitive.

  const US_STATES = [
    ['alabama', 'al'],
    ['alaska', 'ak'],
    ['arizona', 'az'],
    ['arkansas', 'ar'],
    ['california', 'ca', 'calif'],
    ['colorado', 'co'],
    ['connecticut', 'ct', 'conn'],
    ['delaware', 'de'],
    ['florida', 'fl', 'fla'],
    ['georgia', 'ga'],
    ['hawaii', 'hi'],
    ['idaho', 'id'],
    ['illinois', 'il', 'ill'],
    ['indiana', 'in', 'ind'],
    ['iowa', 'ia'],
    ['kansas', 'ks', 'kans'],
    ['kentucky', 'ky'],
    ['louisiana', 'la'],
    ['maine', 'me'],
    ['maryland', 'md'],
    ['massachusetts', 'ma', 'mass'],
    ['michigan', 'mi', 'mich'],
    ['minnesota', 'mn', 'minn'],
    ['mississippi', 'ms', 'miss'],
    ['missouri', 'mo'],
    ['montana', 'mt', 'mont'],
    ['nebraska', 'ne', 'neb', 'nebr'],
    ['nevada', 'nv', 'nev'],
    ['new hampshire', 'nh', 'n.h.'],
    ['new jersey', 'nj', 'n.j.'],
    ['new mexico', 'nm', 'n.m.', 'n mex'],
    ['new york', 'ny', 'n.y.'],
    ['north carolina', 'nc', 'n.c.', 'n carolina'],
    ['north dakota', 'nd', 'n.d.', 'n dakota'],
    ['ohio', 'oh'],
    ['oklahoma', 'ok', 'okla'],
    ['oregon', 'or', 'ore', 'oreg'],
    ['pennsylvania', 'pa', 'penn', 'penna'],
    ['rhode island', 'ri', 'r.i.'],
    ['south carolina', 'sc', 's.c.', 's carolina'],
    ['south dakota', 'sd', 's.d.', 's dakota'],
    ['tennessee', 'tn', 'tenn'],
    ['texas', 'tx', 'tex'],
    ['utah', 'ut'],
    ['vermont', 'vt'],
    ['virginia', 'va'],
    ['washington', 'wa', 'wash'],
    ['west virginia', 'wv', 'w.v.', 'w virginia', 'w va'],
    ['wisconsin', 'wi', 'wis', 'wisc'],
    ['wyoming', 'wy', 'wyo'],
    ['district of columbia', 'dc', 'd.c.', 'washington dc', 'washington d.c.'],
    ['american samoa', 'as'],
    ['guam', 'gu'],
    ['northern mariana islands', 'mp'],
    ['puerto rico', 'pr'],
    ['u.s. virgin islands', 'vi', 'usvi', 'us virgin islands'],
  ];

  const CA_PROVINCES = [
    ['alberta', 'ab'],
    ['british columbia', 'bc', 'b.c.'],
    ['manitoba', 'mb'],
    ['new brunswick', 'nb'],
    ['newfoundland and labrador', 'nl', 'newfoundland', 'nfld'],
    ['northwest territories', 'nt', 'nwt'],
    ['nova scotia', 'ns', 'n.s.'],
    ['nunavut', 'nu'],
    ['ontario', 'on', 'ont'],
    ['prince edward island', 'pe', 'pei', 'p.e.i.'],
    ['quebec', 'qc', 'que', 'qu\u00e9bec'],
    ['saskatchewan', 'sk', 'sask'],
    ['yukon', 'yt'],
  ];

  const COUNTRIES = [
    ['united states', 'us', 'usa', 'u.s.', 'u.s.a.', 'united states of america', 'america'],
    ['canada', 'ca', 'can'],
    ['united kingdom', 'uk', 'gb', 'gbr', 'great britain', 'britain', 'england'],
    ['australia', 'au', 'aus'],
    ['germany', 'de', 'deu', 'deutschland'],
    ['france', 'fr', 'fra'],
    ['india', 'in', 'ind'],
    ['china', 'cn', 'chn'],
    ['japan', 'jp', 'jpn'],
    ['south korea', 'kr', 'kor', 'korea'],
    ['brazil', 'br', 'bra', 'brasil'],
    ['mexico', 'mx', 'mex'],
    ['italy', 'it', 'ita', 'italia'],
    ['spain', 'es', 'esp', 'espa\u00f1a'],
    ['netherlands', 'nl', 'nld', 'holland', 'the netherlands'],
    ['sweden', 'se', 'swe'],
    ['switzerland', 'ch', 'che'],
    ['ireland', 'ie', 'irl'],
    ['singapore', 'sg', 'sgp'],
    ['new zealand', 'nz', 'nzl'],
    ['israel', 'il', 'isr'],
    ['poland', 'pl', 'pol', 'polska'],
    ['norway', 'no', 'nor', 'norge'],
    ['denmark', 'dk', 'dnk'],
    ['finland', 'fi', 'fin'],
    ['belgium', 'be', 'bel'],
    ['austria', 'at', 'aut'],
    ['portugal', 'pt', 'prt'],
    ['argentina', 'ar', 'arg'],
    ['philippines', 'ph', 'phl'],
  ];

  const DEGREES = [
    ['high school', 'hs', 'high school diploma', 'ged', 'g.e.d.', 'secondary', 'secondary education', 'high school or equivalent'],
    ['associate', 'associates', "associate's", 'aa', 'a.a.', 'as', 'a.s.', 'associate degree', "associate's degree", 'associates degree', 'aas', 'a.a.s.'],
    ['bachelor', 'bachelors', "bachelor's", 'bs', 'b.s.', 'ba', 'b.a.', 'bsc', 'b.sc.', 'bachelor of science', 'bachelor of arts', "bachelor's degree", 'bachelors degree', 'undergraduate', '4-year degree', 'four-year degree'],
    ['master', 'masters', "master's", 'ms', 'm.s.', 'ma', 'm.a.', 'msc', 'm.sc.', 'master of science', 'master of arts', "master's degree", 'masters degree', 'graduate degree', 'meng', 'm.eng.', 'master of engineering'],
    ['mba', 'm.b.a.', 'master of business administration'],
    ['doctorate', 'doctoral', 'phd', 'ph.d.', 'doctor of philosophy', 'doctoral degree', 'doctor', 'dphil', 'd.phil.'],
    ['juris doctor', 'jd', 'j.d.', 'law degree'],
    ['medical doctor', 'md', 'm.d.', 'doctor of medicine'],
  ];

  const GENDER = [
    ['male', 'm', 'man', 'cis male', 'cisgender male'],
    ['female', 'f', 'woman', 'cis female', 'cisgender female'],
    ['non-binary', 'nb', 'nonbinary', 'non binary', 'enby', 'genderqueer', 'gender non-conforming', 'gender nonconforming'],
    ['decline to self-identify', 'decline', 'prefer not to say', 'prefer not to answer', 'prefer not to disclose', 'do not wish to answer', 'choose not to disclose', 'i do not wish to self-identify', 'decline to answer', 'decline to state', 'not specified'],
    ['other', 'self-describe', 'not listed'],
  ];

  const RACE_ETHNICITY = [
    ['hispanic or latino', 'hispanic', 'latino', 'latina', 'latinx', 'latine', 'hispanic/latino', 'hispanic or latino/a', 'hispanic/latina/latino'],
    ['white', 'caucasian', 'white (not hispanic or latino)', 'white/caucasian', 'european american'],
    ['black or african american', 'black', 'african american', 'black/african american', 'african-american', 'black or african american (not hispanic or latino)'],
    ['asian', 'asian american', 'east asian', 'south asian', 'southeast asian', 'asian (not hispanic or latino)'],
    ['american indian or alaska native', 'native american', 'american indian', 'alaska native', 'indigenous', 'first nations', 'native american/alaska native', 'american indian/alaska native', 'american indian or alaska native (not hispanic or latino)'],
    ['native hawaiian or other pacific islander', 'native hawaiian', 'pacific islander', 'nhpi', 'native hawaiian/pacific islander', 'native hawaiian or other pacific islander (not hispanic or latino)'],
    ['two or more races', 'multiracial', 'mixed race', 'biracial', 'two or more', 'multi-racial', 'two or more races (not hispanic or latino)'],
    ['decline to self-identify', 'decline', 'prefer not to say', 'prefer not to answer', 'prefer not to disclose', 'choose not to disclose', 'decline to answer', 'i do not wish to self-identify', 'decline to state'],
  ];

  const DISABILITY_STATUS = [
    ['yes', 'i have a disability', 'yes, i have a disability', 'yes, i have a disability (or previously had a disability)', 'i have a disability or previously had a disability', 'disabled'],
    ['no', 'i do not have a disability', 'no, i do not have a disability', 'no, i don\'t have a disability', 'i don\'t have a disability', 'not disabled'],
    ['decline to self-identify', 'decline', 'prefer not to say', 'prefer not to answer', 'i do not wish to answer', 'i don\'t wish to answer', 'do not wish to answer', 'choose not to disclose', 'decline to answer', 'decline to state'],
  ];

  const VETERAN_STATUS = [
    ['i am a protected veteran', 'protected veteran', 'yes', 'veteran', 'i am a veteran', 'i identify as one or more of the classifications of a protected veteran'],
    ['i am not a protected veteran', 'not a protected veteran', 'no', 'not a veteran', 'i am not a veteran', 'non-veteran'],
    ['decline to self-identify', 'decline', 'prefer not to say', 'prefer not to answer', 'i do not wish to answer', 'i don\'t wish to answer', 'do not wish to answer', 'choose not to disclose', 'decline to answer', 'decline to state'],
  ];

  const WORK_AUTH = [
    ['authorized', 'authorized to work', 'yes', 'us citizen', 'citizen', 'u.s. citizen', 'united states citizen', 'authorized to work in the united states', 'authorized to work in the us', 'legally authorized', 'legally authorized to work', 'i am authorized to work in this country'],
    ['permanent resident', 'green card', 'green card holder', 'lawful permanent resident', 'lpr', 'permanent resident alien'],
    ['require sponsorship', 'need sponsorship', 'visa holder', 'work visa', 'h1b', 'h-1b', 'h1-b', 'opt', 'f1', 'f-1', 'ead'],
    ['not authorized', 'no', 'not authorized to work', 'not legally authorized'],
  ];

  const SPONSORSHIP = [
    ['yes', 'y', 'will require sponsorship', 'require sponsorship', 'need sponsorship', 'yes, i will require sponsorship', 'i will require sponsorship now or in the future', 'yes, now or in the future'],
    ['no', 'n', 'will not require sponsorship', 'do not require sponsorship', 'no sponsorship required', 'no, i will not require sponsorship', 'i will not require sponsorship now or in the future', 'no, not now or in the future'],
  ];

  const BOOLEAN_YES_NO = [
    ['yes', 'y', 'true', '1', 'si', 'yep', 'yeah', 'affirmative', 'correct'],
    ['no', 'n', 'false', '0', 'nope', 'nah', 'negative'],
  ];

  // ─── Table Registry ──────────────────────────────────────────

  const ALL_TABLES = {
    US_STATES,
    CA_PROVINCES,
    COUNTRIES,
    DEGREES,
    GENDER,
    RACE_ETHNICITY,
    DISABILITY_STATUS,
    VETERAN_STATUS,
    WORK_AUTH,
    SPONSORSHIP,
    BOOLEAN_YES_NO,
  };

  // ─── Index Builder ───────────────────────────────────────────
  // Build a reverse lookup map: lowered variant -> canonical form (first item in group)

  const _cache = new Map();

  function buildIndex(table) {
    if (_cache.has(table)) return _cache.get(table);
    const index = new Map();
    for (const group of table) {
      const canonical = group[0].toLowerCase();
      for (const variant of group) {
        index.set(variant.toLowerCase(), canonical);
      }
    }
    _cache.set(table, index);
    return index;
  }

  // ─── Core Functions ──────────────────────────────────────────

  function normalizeValue(value, table) {
    if (value == null) return null;
    const cleaned = String(value).trim().toLowerCase();
    if (!cleaned) return null;
    const index = buildIndex(table);
    return index.get(cleaned) || null;
  }

  function areEquivalent(a, b) {
    if (a == null || b == null) return false;
    const cleanA = String(a).trim().toLowerCase();
    const cleanB = String(b).trim().toLowerCase();
    if (cleanA === cleanB) return true;

    for (const table of Object.values(ALL_TABLES)) {
      const index = buildIndex(table);
      const canonA = index.get(cleanA);
      const canonB = index.get(cleanB);
      if (canonA && canonB && canonA === canonB) return true;
    }
    return false;
  }

  function normalizedMatch(options, targetValue, tables) {
    if (!options || !options.length || targetValue == null) return -1;
    const target = String(targetValue).trim().toLowerCase();
    if (!target) return -1;

    const tablesToUse = tables && tables.length ? tables : Object.values(ALL_TABLES);

    // Resolve the target's canonical form across all applicable tables
    const targetCanonicals = new Set();
    targetCanonicals.add(target);
    for (const table of tablesToUse) {
      const index = buildIndex(table);
      const canon = index.get(target);
      if (canon) targetCanonicals.add(canon);
    }

    // Phase 1: exact match on option text (case-insensitive)
    for (let i = 0; i < options.length; i++) {
      const optText = String(options[i]).trim().toLowerCase();
      if (targetCanonicals.has(optText)) return i;
    }

    // Phase 2: canonical match through tables
    for (let i = 0; i < options.length; i++) {
      const optText = String(options[i]).trim().toLowerCase();
      for (const table of tablesToUse) {
        const index = buildIndex(table);
        const optCanon = index.get(optText);
        if (optCanon && targetCanonicals.has(optCanon)) return i;
      }
    }

    // Phase 3: substring containment as fallback
    // Check if any option text contains the target or vice versa
    for (let i = 0; i < options.length; i++) {
      const optText = String(options[i]).trim().toLowerCase();
      if (optText.length < 3 || target.length < 3) continue;
      for (const canon of targetCanonicals) {
        if (optText.includes(canon) || canon.includes(optText)) return i;
      }
    }

    return -1;
  }

  // ─── Field Category Detection ────────────────────────────────

  const FIELD_PATTERNS = [
    { pattern: /\b(state|province|region)\b/i, tables: [US_STATES, CA_PROVINCES] },
    { pattern: /\bcountr/i, tables: [COUNTRIES] },
    { pattern: /\b(degree|education|qualification|diploma)\b/i, tables: [DEGREES] },
    { pattern: /\bgender\b/i, tables: [GENDER] },
    { pattern: /\bsex\b/i, tables: [GENDER] },
    { pattern: /\b(race|racial|ethnicity|ethnic)\b/i, tables: [RACE_ETHNICITY] },
    { pattern: /\bdisabilit/i, tables: [DISABILITY_STATUS] },
    { pattern: /\bveteran\b/i, tables: [VETERAN_STATUS] },
    { pattern: /\b(work\s*auth|authorized?\s*to\s*work|legally\s*auth|employment\s*eligib)/i, tables: [WORK_AUTH] },
    { pattern: /\bsponsorship\b/i, tables: [SPONSORSHIP] },
    { pattern: /\b(yes.?no|true.?false|agree|confirm)\b/i, tables: [BOOLEAN_YES_NO] },
  ];

  function detectFieldCategory(fieldHints) {
    if (!fieldHints) return [];
    const combined = (Array.isArray(fieldHints) ? fieldHints.join(' ') : String(fieldHints)).toLowerCase();
    const matched = new Set();
    for (const { pattern, tables } of FIELD_PATTERNS) {
      if (pattern.test(combined)) {
        for (const t of tables) matched.add(t);
      }
    }
    return [...matched];
  }

  // ─── Phone Normalization ─────────────────────────────────────

  function normalizePhone(value) {
    if (value == null) return '';
    return String(value).replace(/\D/g, '');
  }

  function formatPhoneLike(digits, formatHint) {
    if (!digits) return '';
    const d = String(digits).replace(/\D/g, '');

    // If a format hint is provided (e.g. a placeholder like "(___) ___-____"),
    // try to derive the pattern from it
    if (formatHint) {
      const hint = String(formatHint);

      // Count placeholder slots in the hint
      const slotCount = (hint.match(/[_X#0x\d]/gi) || []).length;

      // Try to use the hint as a formatting template
      if (slotCount > 0 && slotCount <= d.length) {
        let result = '';
        let di = 0;
        for (let i = 0; i < hint.length && di < d.length; i++) {
          const ch = hint[i];
          if (/[_X#0x\d]/i.test(ch)) {
            result += d[di++];
          } else {
            result += ch;
          }
        }
        // Append remaining digits if the hint ran short
        if (di < d.length) result += d.slice(di);
        return result;
      }
    }

    // Default US formatting
    if (d.length === 10) {
      return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    if (d.length === 11 && d[0] === '1') {
      return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    }

    // International: +CC followed by rest
    if (d.length > 10) {
      return `+${d}`;
    }

    // Short numbers: return as-is
    return d;
  }

  // ─── Export ──────────────────────────────────────────────────

  window.__cpNormalize = {
    // Tables
    US_STATES,
    CA_PROVINCES,
    COUNTRIES,
    DEGREES,
    GENDER,
    RACE_ETHNICITY,
    DISABILITY_STATUS,
    VETERAN_STATUS,
    WORK_AUTH,
    SPONSORSHIP,
    BOOLEAN_YES_NO,
    ALL_TABLES,

    // Core functions
    normalizeValue,
    areEquivalent,
    normalizedMatch,
    detectFieldCategory,
    normalizePhone,
    formatPhoneLike,
  };
})();
