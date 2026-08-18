// electron-builder afterPack hook.
// Copies the Next.js standalone server into Contents/Resources/nextjs.
// We do this here (not via extraResources) because electron-builder
// silently excludes node_modules directories from extraResources copies.
const fs = require("fs");
const path = require("path");

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
  fs.cpSync(path.join(root, ".next", "standalone"), dest, {
    recursive: true,
    dereference: true,
    filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}.bin`),
  });

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

  console.log(`[after-pack] Next.js standalone copié vers ${dest}`);
};
