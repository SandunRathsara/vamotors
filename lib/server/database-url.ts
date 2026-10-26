/** Shared runtime/operator boundary. No driver query options except TLS mode. */
export function databaseURL(input: string, role: string): URL | undefined {
  try {
    const url = new URL(input)
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      decodeURIComponent(url.username) !== role ||
      !decodeURIComponent(url.password) ||
      !url.hostname ||
      url.hostname.includes("%") ||
      decodeURI(url.pathname).length < 2 ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      url.searchParams.getAll("sslmode").length !== 1 ||
      !["require", "verify-full"].includes(
        url.searchParams.get("sslmode") ?? ""
      )
    )
      return
    return url
  } catch {
    // URL parser errors can include credentials; never propagate them.
    return
  }
}
