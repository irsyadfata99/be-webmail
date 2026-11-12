export {};

declare global {
  namespace Express {
    interface AuthContext {
      sessionId: string;
      credentialEnc: string;
      csrfTokenHash: string;
      twoFactorVerified: boolean;
      user: {
        id: string;
        email: string;
        displayName: string;
        role: "ADMIN" | "USER";
        twoFactorEnabled: boolean;
      };
    }
    interface Request {
      auth?: AuthContext;
    }
  }
}
