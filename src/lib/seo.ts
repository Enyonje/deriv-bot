const configured = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const siteUrl = (path = "/"): string => {
  try { return new URL(path, configured.endsWith("/") ? configured : `${configured}/`).toString(); }
  catch { return new URL(path, "http://localhost:3000").toString(); }
};
