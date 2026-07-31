const HREF =
  "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700;800;900&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..600&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

/**
 * Attach the display/body/data faces after the page has loaded.
 *
 * A `<link rel="stylesheet">` in `<head>` holds back the `load` event until the font host
 * answers — on a machine with no route to fonts.googleapis.com that is a hang, not a
 * slowdown, and it stalled the whole app behind a decorative request. Injecting the sheet
 * once `load` has already fired makes the fonts strictly additive: the stack in
 * `styles.css` (Georgia / ui-monospace) renders immediately and is swapped when the real
 * faces arrive.
 */
export function loadWebfonts(): void {
  if (typeof document === "undefined") return;

  const attach = () => {
    if (document.querySelector('link[data-webfonts="brand"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = HREF;
    link.dataset.webfonts = "brand";
    document.head.appendChild(link);
  };

  if (document.readyState === "complete") attach();
  else window.addEventListener("load", attach, { once: true });
}
