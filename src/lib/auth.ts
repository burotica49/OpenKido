import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import "@auth/core/jwt";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Required when running behind a proxy (Dokploy) or on a non-standard
  // host like localhost:3001 (Electron).
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: { scope: "read:user user:email repo" },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      const login = (profile as { login?: string } | undefined)?.login;
      if (login) token.githubLogin = login;
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
