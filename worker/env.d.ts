declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ADMIN_ACCESS_TOKEN: string;
    AUTH_SIGNING_SECRET: string;
  }
}
