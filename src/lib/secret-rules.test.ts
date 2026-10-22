import { describe, expect, it } from "vitest";
import { isScannablePath, isTestOrDocPath, looksLikePlaceholder, scanText, shannonEntropy } from "./secret-rules";

const ids = (path: string, text: string) => scanText(path, text).map((f) => f.ruleId);

describe("scanText", () => {
  it("détecte des formats de fournisseurs", () => {
    expect(ids("src/a.ts", 'const k = "AKIAQWERTYUIOPASDFGH";')).toEqual(["aws-access-key"]);
    expect(ids("a.js", "token: ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8")).toEqual(["github-token"]);
    expect(ids("k.pem", "-----BEGIN RSA PRIVATE KEY-----")).toEqual(["private-key"]);
    expect(ids("a.ts", "const s = 'sk_live_" + "51Habcdefghijklmnopqrstuv';")).toEqual(["stripe-live-key"]);
  });
  it("ignore les valeurs factices et placeholders", () => {
    expect(ids("a.ts", "AKIAIOSFODNN7EXAMPLE")).toEqual([]);
    expect(ids("a.ts", 'password = "your-password-here-please"')).toEqual([]);
    expect(ids("a.ts", 'const secret = process.env.SECRET_KEY_BASE_VALUE_XYZ')).toEqual([]);
    expect(ids(".env", "DATABASE_URL=postgres://user:${DB_PASSWORD}@host/db")).toEqual([]);
    expect(ids("a.ts", 'apiKey: "xxxxxxxxxxxxxxxx"')).toEqual([]);
    expect(ids("docker-compose.yml", "DATABASE_URL: postgres://postgres:postgres@db:5432/app")).toEqual([]);
    expect(ids("c.php", "'client_secret' => 'RANDOMCHARS-FROM-GOOGLE-CONSOLE'")).toEqual([]);
  });
  it("détecte une URL de base de données avec mot de passe réel et masque le mot de passe", () => {
    const [f] = scanText("config.ts", 'const u = "postgres://admin:Zq8!kP2mXv9@db.internal:5432/app";');
    expect(f.ruleId).toBe("db-connection");
    expect(f.preview).not.toContain("Zq8!kP2mXv9");
    expect(f.preview).toContain("••••");
  });
  it("règle générique : exige une forte entropie et ignore tests/docs", () => {
    expect(ids("src/a.ts", 'const apiKey = "k7Gx9PqL2vNb8RtYw3Zs";')).toEqual(["generic-secret"]);
    expect(ids("src/a.ts", 'const password = "aaaaaaaaaaaaaaaaaa";')).toEqual([]);
    expect(ids("tests/a.test.ts", 'const apiKey = "k7Gx9PqL2vNb8RtYw3Zs";')).toEqual([]);
    expect(ids("README.md", 'apiKey = "k7Gx9PqL2vNb8RtYw3Zs"')).toEqual([]);
  });
  it("un format de fournisseur dans un test reste signalé, avec une gravité réduite", () => {
    const [f] = scanText("tests/a.test.ts", "AKIAQWERTYUIOPASDFGH");
    expect(f.severity).toBe("high");
  });
  it("ne conserve jamais la valeur complète", () => {
    const secret = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const [f] = scanText("a.ts", secret);
    expect(JSON.stringify(f)).not.toContain(secret);
    expect(f.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(f.line).toBe(1);
  });
  it("empreinte stable, indépendante de la ligne", () => {
    const a = scanText("a.ts", "AKIAQWERTYUIOPASDFGH")[0].fingerprint;
    const b = scanText("a.ts", "\n\n// x\nAKIAQWERTYUIOPASDFGH")[0].fingerprint;
    expect(a).toBe(b);
  });
  it("ignore les lignes très longues (code minifié)", () => {
    expect(ids("a.js", "x".repeat(2500) + " AKIAQWERTYUIOPASDFGH")).toEqual([]);
  });
});

describe("chemins", () => {
  it("filtre dépendances, builds, binaires et lockfiles", () => {
    expect(isScannablePath("src/index.ts")).toBe(true);
    expect(isScannablePath(".env")).toBe(true);
    expect(isScannablePath("node_modules/a/index.js")).toBe(false);
    expect(isScannablePath("package-lock.json")).toBe(false);
    expect(isScannablePath("public/logo.png")).toBe(false);
    expect(isScannablePath("dist/app.min.js")).toBe(false);
  });
  it("reconnaît tests et docs", () => {
    expect(isTestOrDocPath("src/__tests__/a.ts")).toBe(true);
    expect(isTestOrDocPath("README.md")).toBe(true);
    expect(isTestOrDocPath("src/lib/a.ts")).toBe(false);
  });
  it("entropie et placeholders", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("k7Gx9PqL2vNb8RtYw3Zs")).toBeGreaterThan(3.6);
    expect(looksLikePlaceholder("changeme")).toBe(true);
  });
});
