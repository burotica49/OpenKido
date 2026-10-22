import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import "@auth/core/jwt";
import { getGithubLogin, listOrgs } from "@/lib/github";

function parseList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Required when running behind a proxy (Dokploy) or on a non-standard
  // host like localhost:3001 (Electron).
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "read:user user:email repo read:org",
          // Force l’écran d’autorisation GitHub (compte + orgs) au lieu d’un auto-login silencieux.
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    // Liste blanche (instance web) : ALLOWED_GITHUB_LOGINS et/ou ALLOWED_GITHUB_ORGS, séparés
    // par des virgules. Vides = tout compte GitHub peut se connecter (usage desktop : chacun
    // ne voit que ses propres dépôts avec son propre jeton).
    async signIn({ account, profile }) {
      const logins = parseList(process.env.ALLOWED_GITHUB_LOGINS);
      const orgs = parseList(process.env.ALLOWED_GITHUB_ORGS);
      if (logins.length === 0 && orgs.length === 0) return true;

      const login = (profile as { login?: string } | undefined)?.login?.toLowerCase();
      if (login && logins.includes(login)) return true;

      if (orgs.length > 0 && account?.access_token) {
        try {
          const mine = await listOrgs(account.access_token);
          if (mine.some((o) => orgs.includes(o.login.toLowerCase()))) return true;
        } catch (error) {
          console.error("[auth] vérification des organisations impossible:", error);
        }
      }
      console.warn(`[auth] connexion refusée pour @${login ?? "?"} (hors liste autorisée)`);
      return false;
    },
    async jwt({ token, account, profile }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      const login = (profile as { login?: string } | undefined)?.login;
      if (login) token.githubLogin = login;
      if (!token.githubLogin && typeof token.accessToken === "string") {
        try {
          token.githubLogin = await getGithubLogin(token.accessToken);
        } catch {}
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      if (typeof token.githubLogin === "string") {
        session.githubLogin = token.githubLogin;
      }
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    accessToken: string;
    githubLogin?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    accessToken?: string;
    githubLogin?: string;
  }
}
