const system_pref = window.matchMedia('(prefers-color-scheme: dark)');
const system_theme = system_pref.matches ? 'dark' : 'light';
const user_pref = localStorage.getItem('theme');

let current_theme = user_pref ?? system_theme;

function toggle(user_initiated) {
  if (current_theme === 'light') {
    current_theme = 'dark';
  } else {
    current_theme = 'light';
  }

  if (user_initiated) {
    localStorage.setItem('theme', current_theme);
  }
  document.documentElement.setAttribute('data-theme', current_theme);
}

document.querySelector('#theme-toggle').onclick = (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggle(true);
};

system_pref.addEventListener('change', () => {
  if (localStorage.getItem('theme')) {
    // we have a user pref, so don't switch;
    return;
  }
  toggle(false);
});
