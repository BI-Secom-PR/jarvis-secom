/**
 * Live channel between the voice overlay and the arc HUD canvas.
 *
 * A plain mutable object on purpose: `HudBackground` reads it inside its
 * requestAnimationFrame loop, so this must not trigger a React render — and a
 * context would have to wrap a server component (`app/chat/page.tsx`) to reach
 * both sides. Both consumers are client components importing this module, so
 * the shared instance is all the plumbing needed.
 */
export const hudSignal = {
  /** 0..1 audio level: the mic while listening, the TTS output while speaking. */
  amplitude: 0,
  /**
   * True while a full-screen overlay owns the HUD. Page-level instances then
   * skip their draw work instead of animating unseen behind the overlay, so
   * only one canvas is ever doing the O(n²) particle-link pass.
   */
  overlayOpen: false,
};
