// Client-side authentication interactions
document.addEventListener('DOMContentLoaded', () => {
  const alertContainer = document.getElementById('alert-container');

  if (alertContainer) {
    setTimeout(() => {
      alertContainer.style.opacity = '0';
      setTimeout(() => alertContainer.remove(), 300);
    }, 5000);
  }

  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      if (!input) return;

      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      button.setAttribute('aria-pressed', String(!visible));
      button.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
      button.innerHTML = visible ? '<i class="bi bi-eye"></i>' : '<i class="bi bi-eye-slash"></i>';
    });
  });
});
