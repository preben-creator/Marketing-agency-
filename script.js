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

// Reveal sections on scroll
const revealEls = document.querySelectorAll('.section__head, .card, .service, .steps li, .plan, .quote, .stats__grid > div');
revealEls.forEach(el => el.classList.add('reveal'));
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  revealEls.forEach(el => io.observe(el));
} else {
  revealEls.forEach(el => el.classList.add('is-visible'));
}

// Footer year
document.getElementById('year').textContent = new Date().getFullYear();
