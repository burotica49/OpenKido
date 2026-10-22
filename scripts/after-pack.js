/* eslint-disable @typescript-eslint/no-require-imports */
// electron-builder afterPack hook.
// Copies the Next.js standalone server into Contents/Resources/nextjs.
// We do this here (not via extraResources) because electron-builder
// silently excludes node_modules directories from extraResources copies.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Valeurs de `context.arch` (enum Arch d'electron-builder).
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

// Modules natifs propres à chaque architecture. `npm install` ne télécharge que ceux de la machine de build :
// une app x64 construite sur un Mac arm64 n'aurait sinon aucun binaire libsql (le serveur ne démarre pas).
// [paquet qui déclare la dépendance optionnelle, nom du paquet natif pour l'architecture]
const NATIVE_PACKAGES = (arch) => [
  ["libsql", `@libsql/darwin-${arch}`],
  ["sharp", `@img/sharp-darwin-${arch}`],
  ["sharp", `@img/sharp-libvips-darwin-${arch}`],
];

/** Garantit que le binaire natif de l'architecture cible est présent (téléchargé une fois, puis mis en cache). */
function ensureNativePackage(root, dest, owner, pkgName) {
  const target = path.join(dest, "node_modules", pkgName);
  if (fs.existsSync(path.join(target, "package.json"))) return;

  const ownerPkg = JSON.parse(fs.readFileSync(path.join(root, "node_modules", owner, "package.json"), "utf8"));
  const version = ownerPkg.optionalDependencies && ownerPkg.optionalDependencies[pkgName];
  if (!version) throw new Error(`${owner} ne déclare pas ${pkgName} : impossible de préparer cette architecture`);

  const cache = path.join(root, "build", "native-cache");
  fs.mkdirSync(cache, { recursive: true });
  const tgz = path.join(cache, `${pkgName.replace(/[@/]/g, "_")}-${version}.tgz`);
  if (!fs.existsSync(tgz)) {
    console.log(`[after-pack] téléchargement de ${pkgName}@${version}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openkido-pack-"));
    try {
      execFileSync("npm", ["pack", `${pkgName}@${version}`, "--pack-destination", tmp, "--silent"], { cwd: tmp, stdio: "pipe" });
      const packed = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
      if (!packed) throw new Error("archive introuvable");
      fs.copyFileSync(path.join(tmp, packed), tgz);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const extract = fs.mkdtempSync(path.join(os.tmpdir(), "openkido-extract-"));
  try {
    execFileSync("tar", ["-xzf", tgz, "-C", extract], { stdio: "pipe" });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(extract, "package"), target, { recursive: true });
  } finally {
    fs.rmSync(extract, { recursive: true, force: true });
  }
  console.log(`[after-pack] ${pkgName}@${version} ajouté pour cette architecture`);
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const root = context.packager.projectDir;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const resources = path.join(context.appOutDir, appName, "Contents", "Resources");
  const dest = path.join(resources, "nextjs");

  fs.rmSync(dest, { recursive: true, force: true });

  // Standalone server (includes node_modules, src/generated, .env).
  // dereference: codesign rejects symlinks pointing outside the bundle;
  // .bin is excluded (symlink farm, useless at runtime).
  const standalone = path.join(root, ".next", "standalone");
  fs.cpSync(standalone, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      if (src.includes(`${path.sep}node_modules${path.sep}.bin`)) return false;
      // Sorties de build tracées par Next dans le standalone (ancien .app → échec de codesign).
      const rel = path.relative(standalone, src).split(path.sep)[0];
      return !["dist", "build", ".git", "release"].includes(rel);
    },
  });

  // Binaires natifs de l'architecture cible (x64 ou arm64), et seulement ceux-là.
  const arch = ARCH_NAMES[context.arch];
  if (arch === "x64" || arch === "arm64") {
    for (const [owner, pkg] of NATIVE_PACKAGES(arch)) ensureNativePackage(root, dest, owner, pkg);
    const other = arch === "x64" ? "arm64" : "x64";
    for (const [, pkg] of NATIVE_PACKAGES(other)) fs.rmSync(path.join(dest, "node_modules", pkg), { recursive: true, force: true });
  }

  // Static assets + public
  fs.cpSync(path.join(root, ".next", "static"), path.join(dest, ".next", "static"), { recursive: true });
  fs.cpSync(path.join(root, "public"), path.join(dest, "public"), { recursive: true });

  // Next.js standalone only carries .env — the auth secrets live in
  // .env.local, which must ship with the desktop app for login to work.
  const envLocal = path.join(root, ".env.local");
  if (!fs.existsSync(envLocal)) {
    throw new Error(".env.local manquant — requis pour l'auth GitHub de l'app desktop");
  }
  fs.cpSync(envLocal, path.join(dest, ".env.local"));

  // Pre-migrated template DB (created by electron:template-db script)
  const prismaDest = path.join(dest, "prisma");
  fs.mkdirSync(prismaDest, { recursive: true });
  const template = path.join(root, "build", "template.db");
  if (!fs.existsSync(template)) {
    throw new Error("build/template.db manquant — lancez `npm run electron:template-db` avant le build");
  }
  fs.cpSync(template, path.join(prismaDest, "template.db"));

  // Migrations SQL : appliquées au démarrage du serveur (src/instrumentation.ts),
  // ce qui met aussi à jour les bases créées par une version précédente de l'app.
  const migrations = path.join(root, "prisma", "migrations");
  if (!fs.existsSync(migrations)) {
    throw new Error("prisma/migrations manquant");
  }
  fs.cpSync(migrations, path.join(prismaDest, "migrations"), { recursive: true });

  console.log(`[after-pack] Next.js standalone copié vers ${dest}`);
};
