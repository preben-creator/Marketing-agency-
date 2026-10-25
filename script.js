// Mobile menu
const nav = document.querySelector('.nav');
const toggle = document.querySelector('.nav__toggle');
toggle.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  toggle.setAttribute('aria-expanded', open);
});
document.querySelectorAll('.nav__links a').forEach(a =>
  a.addEventListener('click', () => {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', false);
  })
);

// Nav border on scroll
const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 10);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Work filters
const chips = document.querySelectorAll('.chip');
const cards = document.querySelectorAll('.card');
chips.forEach(chip =>
  chip.addEventListener('click', () => {
    chips.forEach(c => c.classList.toggle('is-active', c === chip));
    const f = chip.dataset.filter;
    cards.forEach(card => card.classList.toggle('is-hidden', f !== 'all' && card.dataset.cat !== f));
  })
);

// Video lightbox: works with YouTube/Vimeo embed URLs or direct .mp4/.webm files
const modal = document.getElementById('modal');
const slot = document.getElementById('modal-video');
let lastFocus = null;

function openVideo(src) {
  lastFocus = document.activeElement;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) {
    slot.innerHTML = `<video src="${src}" controls autoplay playsinline></video>`;
  } else {
    const url = src + (src.includes('?') ? '&' : '?') + 'autoplay=1';
    slot.innerHTML = `<iframe src="${url}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Video"></iframe>`;
  }
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  modal.querySelector('.modal__close').focus();
}

function closeVideo() {
  modal.hidden = true;
  slot.innerHTML = '';
  document.body.style.overflow = '';
  if (lastFocus) lastFocus.focus();
}

document.querySelectorAll('[data-video]').forEach(el =>
  el.addEventListener('click', () => openVideo(el.dataset.video))
);
modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeVideo));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeVideo(); });

// Animations, powered by Motion (motion.dev, bundled in assets/vendor/motion.js)
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

if (!window.Motion || reduceMotion) {
  // No library or the visitor prefers less motion: show everything as-is
  root.classList.remove('js-motion');
} else {
  const { animate, inView, scroll, stagger } = window.Motion;
  const ease = [0.22, 1, 0.36, 1];

  // Hero entrance
  const heroItems = document.querySelectorAll('.hero__inner > *');
  animate(heroItems, { opacity: [0, 1], y: [32, 0] }, { duration: 0.9, delay: stagger(0.12), ease });
  root.classList.remove('js-motion');

  // Gentle parallax on the showreel as you scroll past the hero
  const reel = document.querySelector('.reel');
  scroll(animate(reel, { y: [0, -60], scale: [1, 0.96] }, { ease: 'linear' }), {
    target: document.querySelector('.hero'),
    offset: ['start start', 'end start'],
  });

  // Scroll progress bar at the top of the page
  scroll(animate('.progress', { scaleX: [0, 1] }, { ease: 'linear' }));

  // Section headings and groups of cards fade up, one after another
  const groups = [
    ['.section__head', ':scope > *'],
    ['.work-grid', '.card'],
    ['.services', '.service'],
    ['.steps', 'li'],
    ['.pricing', '.plan'],
    ['.quotes', '.quote'],
    ['.contact__inner', ':scope > *'],
  ];
  groups.forEach(([container, child]) => {
    document.querySelectorAll(container).forEach(el => {
      const items = el.querySelectorAll(child);
      items.forEach(i => { i.style.opacity = 0; });
      inView(el, () => {
        animate(items, { opacity: [0, 1], y: [40, 0] }, { duration: 0.8, delay: stagger(0.1), ease });
      }, { amount: 0.15 });
    });
  });

  // Count the stats up from zero when they come into view
  document.querySelectorAll('.stats strong').forEach(el => {
    const match = el.textContent.match(/^([\d.,]+)(.*)$/);
    if (!match) return;
    const target = parseFloat(match[1].replace(',', ''));
    const decimals = (match[1].split('.')[1] || '').length;
    const suffix = match[2];
    el.textContent = (0).toFixed(decimals) + suffix;
    inView(el, () => {
      animate(0, target, {
        duration: 1.6,
        ease,
        onUpdate: v => { el.textContent = v.toFixed(decimals) + suffix; },
      });
    }, { amount: 0.6 });
  });
}

// More animations, powered by anime.js (animejs.com, bundled in assets/vendor/anime.min.js)
if (window.anime && !reduceMotion) {
  // Pulsing ring around the showreel play button
  const play = document.querySelector('.reel .play');
  const ring = document.createElement('span');
  ring.className = 'play__ring';
  play.appendChild(ring);
  anime({
    targets: ring,
    scale: [1, 1.7],
    opacity: [0.6, 0],
    duration: 1800,
    easing: 'easeOutQuad',
    loop: true,
  });

  // Service icons draw themselves line by line when the section comes into view
  const iconShapes = document.querySelectorAll('.service .icon svg > *');
  anime.set(iconShapes, { strokeDashoffset: anime.setDashoffset });
  const drawIcons = () => anime({
    targets: iconShapes,
    strokeDashoffset: [anime.setDashoffset, 0],
    duration: 1400,
    delay: anime.stagger(80, { start: 300 }),
    easing: 'easeInOutSine',
  });
  const servicesEl = document.querySelector('.services');
  const io = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) { drawIcons(); io.disconnect(); }
  }, { threshold: 0.2 });
  io.observe(servicesEl);

  // The "Most popular" badge gives a little bounce every few seconds
  anime({
    targets: '.plan__badge',
    translateY: [0, -6, 0],
    duration: 900,
    delay: 3000,
    easing: 'easeOutElastic(1, .5)',
    loop: true,
  });
}

// Footer year
document.getElementById('year').textContent = new Date().getFullYear();
