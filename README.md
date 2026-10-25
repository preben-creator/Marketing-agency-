# Lumen Motion website

A static one-page site for an AI video marketing agency. Plain HTML, CSS and JavaScript, with no build step, so it runs on GitHub Pages for free.

## Files

- `index.html`: all page content (text, videos, prices, contact details)
- `styles.css`: design. Change the colours and fonts in the `:root` block at the top to rebrand.
- `script.js`: mobile menu, work filters, video player, scroll animations
- `assets/favicon.svg`: browser tab icon
- `assets/islands/`: the built React sections (don't edit by hand, see below)
- `islands/`: source for the React sections

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

## Animations

Animations use [Motion](https://motion.dev) and [anime.js](https://animejs.com) (both MIT licence), bundled locally in `assets/vendor/` so the site doesn't depend on a CDN. Motion handles the scroll effects; anime.js handles the pulsing play button, the self-drawing service icons and the bouncing "Most popular" badge. The animation code is at the bottom of `script.js`. Visitors who have "reduce motion" turned on in their system settings see the page without animations.

## React sections (Bklit UI and Kokonut UI)

The Results section uses [Bklit UI](https://bklit.com) charts, and the flip-board headline and the flowing lines behind the contact form use [Kokonut UI](https://kokonutui.com) (both MIT licence). These are React components, so their source lives in `islands/` and is built into `assets/islands/islands.js` and `islands.css`. The rest of the page stays plain HTML.

To change the chart numbers or the flip-board words, edit `islands/src/main.jsx`, then rebuild:

```
cd islands
npm install
npm run build
```

Commit the updated files in `assets/islands/` so GitHub Pages serves them.
