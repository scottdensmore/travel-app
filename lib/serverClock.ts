/**
 * The server's clock, read where reading it is allowed.
 *
 * A server component that calls `Date.now()` in its body is calling an impure
 * function during render, which the React compiler refuses -- and rightly: a
 * component that reads the clock renders differently every time it runs.
 *
 * A page still sometimes needs the time, and the honest way to get it is to
 * fetch it like any other input, then pass it down as a value. The profile
 * passes it to `ProfileClient` so that "has this flight departed" is decided
 * once, on the server, rather than separately by the markup and by the client
 * that hydrates it -- which is a mismatch, and around a departure boundary a
 * visible one (#76).
 */
export async function serverRenderTime(): Promise<number> {
    return Date.now();
}
