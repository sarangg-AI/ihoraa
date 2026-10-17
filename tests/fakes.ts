// Fake secrets are assembled at runtime so no realistic-looking key is ever
// committed to the repo (that would trip GitHub push protection).

let seed = 1;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

export function randomChars(length: number, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789"): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

const b64url = (obj: object) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const fake = {
  openai: () => ["sk", "proj", randomChars(64)].join("-"),
  anthropic: () => ["sk", "ant", "api03", randomChars(80)].join("-"),
  stripeLive: () => ["sk", "live", randomChars(40)].join("_"),
  awsId: () => "AK" + "IA" + randomChars(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"),
  google: () => "AI" + "za" + randomChars(35),
  github: () => "gh" + "p_" + randomChars(36),
  supabaseService: () =>
    [b64url({ alg: "HS256", typ: "JWT" }), b64url({ iss: "supabase", role: "service_role", ref: randomChars(12) }), randomChars(43)].join("."),
  supabaseAnon: () =>
    [b64url({ alg: "HS256", typ: "JWT" }), b64url({ iss: "supabase", role: "anon", ref: randomChars(12) }), randomChars(43)].join("."),
  dbUrl: () => "postgres" + "ql://admin:" + randomChars(18) + "@db." + randomChars(10).toLowerCase() + ".supabase.co:5432/postgres",
  generic: () => randomChars(32),
};
