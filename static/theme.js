const system_pref = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const user_pref = localStorage.getItem('theme');

let current_theme = user_pref ?? system_pref;

document.documentElement.setAttribute('data-theme', current_theme);

function toggle() {
  if (current_theme === 'light') {
    current_theme = 'dark';
    if (system_pref === 'dark') {
      localStorage.removeItem('theme');
    } else {
      localStorage.setItem('theme', 'dark');
    }
  } else {
    current_theme = 'light';
    if (system_pref === 'light') {
      localStorage.removeItem('theme');
    } else {
      localStorage.setItem('theme', 'light');
    }
  }

  document.documentElement.setAttribute('data-theme', current_theme);
}

document.querySelector('#theme-toggle').onclick = (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggle();
};
