import { BOARD_SEAT_SHADES, recolorBoardSvg } from "./accessibility";

const urls = new Map<string, Promise<string>>();

/**
 * A vector board with its seat colours moved onto the colour-blind palette
 * (F5.5), as a blob: URL an <img> or <image> can show. A blob: URL is
 * same-origin, so a canvas it's drawn into stays usable as a WebGL texture.
 * One per board per page load: the URL is kept for the next table.
 */
export function recoloredArtworkUrl(src: string, artwork: string): Promise<string> {
  const key = `${artwork}:${src}`;
  let url = urls.get(key);
  if (!url) {
    const shades = BOARD_SEAT_SHADES[artwork];
    url = fetch(src)
      .then((response) => {
        if (!shades) throw new Error(`No seat colours listed for ${artwork}`);
        if (!response.ok) throw new Error(`Could not load ${src}`);
        return response.text();
      })
      .then((svg) =>
        URL.createObjectURL(new Blob([recolorBoardSvg(svg, shades!)], { type: "image/svg+xml" })),
      );
    // A failed fetch can be retried by the next table.
    url.catch(() => urls.delete(key));
    urls.set(key, url);
  }
  return url;
}
