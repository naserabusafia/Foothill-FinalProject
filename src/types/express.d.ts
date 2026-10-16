declare global {
  namespace Express {
    interface Request {
      /** Set by apiKeyAuth. Read it through getAccountId(req). */
      accountId?: string;
    }
  }
}

export {};
