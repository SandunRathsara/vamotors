/** Shared runtime/operator boundary. No driver query options except TLS mode. */
export function databaseURL(
  input: string,
  role: string,
  local = false
): URL | undefined {
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
      !(
        ["require", "verify-full"].includes(
          url.searchParams.get("sslmode") ?? ""
        ) ||
        (local &&
          url.hostname === "127.0.0.1" &&
          url.searchParams.get("sslmode") === "disable")
      ) ||
      (local && url.hostname !== "127.0.0.1")
    )
      return
    return url
  } catch {
    // URL parser errors can include credentials; never propagate them.
    return
  }
}
