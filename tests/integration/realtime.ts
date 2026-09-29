/**
 * Local Realtime shuts down after about 12 minutes with no connected users.
 * The next subscriber starts it again, including the database stream that
 * carries broadcasts sent with realtime.send, and SUBSCRIBED can arrive
 * before that stream is up. Anything broadcast in that gap is lost, not
 * delayed, so the first run after a quiet spell used to time out.
 *
 * The app recovers from this on its own (it reloads room state on join);
 * tests that expect a broadcast must first prove the stream is live:
 * repeat a harmless trigger until a broadcast is delivered.
 */
export async function realtimeReady(
  trigger: () => Promise<unknown>,
  delivered: () => boolean,
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await trigger();
    const retryAt = Date.now() + 1_000;
    while (Date.now() < retryAt) {
      if (delivered()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  throw new Error("Realtime never delivered a broadcast");
}
