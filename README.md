# Lumen Motion website

A static one-page site for an AI video marketing agency. Plain HTML, CSS and JavaScript, with no build step, so it runs on GitHub Pages for free.

## Files

- `index.html`: all page content (text, videos, prices, contact details)
- `styles.css`: design. Change the colours and fonts in the `:root` block at the top to rebrand.
- `script.js`: mobile menu, work filters, video player, scroll animations
- `assets/favicon.svg`: browser tab icon

## Customising

- **Agency name:** search and replace `Lumen Motion` in `index.html`.
- **Videos:** every play button has a `data-video` attribute. Paste a YouTube embed URL (`https://www.youtube.com/embed/VIDEO_ID`), a Vimeo one (`https://player.vimeo.com/video/VIDEO_ID`), or a path to an `.mp4` file in `assets/`.
- **Contact form:** create a free form at [formspree.io](https://formspree.io) and put its URL in the form's `action`.
- **Email, stats, prices, testimonials:** edit the text directly in `index.html`. The current values are placeholders.

## Publishing on GitHub Pages

1. Push these files to the root of your repository's `main` branch.
2. On GitHub, open the repository's **Settings → Pages**.
3. Under **Build and deployment**, set Source to **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

To use your own domain, add it under **Settings → Pages → Custom domain**.
