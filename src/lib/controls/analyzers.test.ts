import { describe, expect, it } from "vitest";
import { analyzeTree, analyzeWorkflow } from "./analyzers";

describe("analyzeWorkflow", () => {
  it("détecte pull_request_target + checkout du head de la PR, et les actions non épinglées", () => {
    const w = analyzeWorkflow("a.yml", `name: CI
on:
  pull_request_target:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: some-org/some-action@main
      - uses: actions/setup-node@8f152de45cc393bb48ce5d89d36b731f54556e65 # v4
      - run: npm ci && npm test
`);
    expect(w.usesPullRequestTarget).toBe(true);
    expect(w.checksOutPullRequestHead).toBe(true);
    expect(w.uses.filter((u) => !u.pinned).map((u) => u.action)).toEqual(["actions/checkout", "some-org/some-action"]);
    expect(w.uses[0].firstParty).toBe(true);
    expect(w.uses[1].firstParty).toBe(false);
    expect(w.uses[2].pinned).toBe(true);
    expect(w.hasPermissions).toBe(false);
  });

  it("détecte l'injection dans `run:` (inline et bloc) sans signaler l'usage sûr via env", () => {
    const w = analyzeWorkflow("b.yml", `on: [push, pull_request]
permissions:
  contents: read
jobs:
  t:
    runs-on: [self-hosted, linux]
    steps:
      - run: echo "Title: \${{ github.event.pull_request.title }}"
      - name: bloc
        run: |
          echo hi
          curl "https://x.example/\${{ github.head_ref }}"
      - env:
          TITLE: \${{ github.event.pull_request.title }}
        run: echo "$TITLE"
      - run: echo "\${{ github.sha }} \${{ secrets.TOKEN }} \${{ github.event.pull_request.number }}"
`);
    expect(w.injections.map((i) => [i.line, i.expression])).toEqual([[8, "github.event.pull_request.title"], [12, "github.head_ref"]]);
    expect(w.hasPermissions).toBe(true);
    expect(w.usesPullRequestTarget).toBe(false);
    expect(w.selfHosted).toBe(true);
  });

  it("gère les permissions par job et write-all", () => {
    expect(analyzeWorkflow("c.yml", `on: push\njobs:\n  a:\n    permissions: read-all\n    runs-on: ubuntu-latest\n  b:\n    runs-on: ubuntu-latest\n`).hasPermissions).toBe(false);
    const w = analyzeWorkflow("d.yml", `on: push\njobs:\n  a:\n    permissions: write-all\n    runs-on: ubuntu-latest\n  b:\n    permissions:\n      contents: read\n    runs-on: ubuntu-latest\n`);
    expect(w.hasPermissions).toBe(true);
    expect(w.writeAll).toBe(true);
  });

  it("pull_request_target sans checkout du head n'est pas dangereux", () => {
    const w = analyzeWorkflow("e.yml", `on:\n  pull_request_target:\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo ok\n`);
    expect(w.usesPullRequestTarget).toBe(true);
    expect(w.checksOutPullRequestHead).toBe(false);
  });

  it("ignore commentaires, actions locales et docker://, lit les workflows réutilisables", () => {
    const w = analyzeWorkflow("f.yml", `# uses: evil/action@v1\non: push\njobs:\n  x:\n    steps:\n      - uses: ./.github/actions/local\n      - uses: docker://alpine:3\n      - uses: org/reusable/.github/workflows/w.yml@abc123\n`);
    expect(w.uses.map((u) => u.action)).toEqual(["org/reusable/.github/workflows/w.yml"]);
  });
});

describe("analyzeTree", () => {
  const t = analyzeTree([
    ".env", ".env.example", ".env.local", "src/app.ts", "config/.env.production", "keys/id_rsa", "keys/id_rsa.pub", "certs/server.pem",
    "tests/fixtures/fake.pem", "data/app.db", "terraform.tfstate", "infra/prod.tfvars", "infra/prod.tfvars.example", "libs/tool.jar",
    "gradle/wrapper/gradle-wrapper.jar", "node_modules/left-pad/index.js", "SECURITY.md", ".github/CODEOWNERS", "LICENSE", ".github/dependabot.yml",
    ".github/workflows/ci.yml", ".github/workflows/notes.md", "package.json", "apps/web/package.json", "apps/api/package.json", "apps/api/package-lock.json",
    "examples/demo/package.json", "svc/go.mod", "svc/go.sum", "other/go.mod", "Gemfile",
  ]);

  it("repère les fichiers sensibles (exemples, clés publiques et gradle-wrapper exclus) avec un niveau de confiance", () => {
    const sens = Object.fromEntries(t.sensitive.map((s) => [s.path, s.confidence]));
    expect(Object.keys(sens).sort()).toEqual([".env", ".env.local", "certs/server.pem", "config/.env.production", "data/app.db", "infra/prod.tfvars", "keys/id_rsa", "terraform.tfstate", "tests/fixtures/fake.pem"].sort());
    expect(sens[".env"]).toBe("high");
    expect(sens["tests/fixtures/fake.pem"]).toBe("low");
  });
  it("signale les artefacts versionnés (node_modules, jar) mais tolère gradle-wrapper.jar", () => {
    expect(t.artifacts.some((a) => a.startsWith("node_modules/"))).toBe(true);
    expect(t.artifacts).toContain("libs/tool.jar");
    expect(t.artifacts.some((a) => a.includes("gradle-wrapper"))).toBe(false);
  });
  it("détecte la gouvernance et les workflows", () => {
    expect(t.has).toEqual({ securityPolicy: true, codeowners: true, license: true, dependabot: true, renovate: false });
    expect(t.workflowFiles).toEqual([".github/workflows/ci.yml"]);
    expect(t.hasDependencyManifest).toBe(true);
  });
  it("liste les lockfiles manquants (hors exemples), racine distinguée", () => {
    const gaps = t.lockfileGaps.map((g) => `${g.ecosystem}:${g.path}${g.root ? "*" : ""}`).sort();
    expect(gaps).toEqual(["Go:other", "Ruby:racine*", "npm:apps/web", "npm:racine*"].sort());
  });
});
