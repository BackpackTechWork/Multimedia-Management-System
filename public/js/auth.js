// Client-side authentication interactions
document.addEventListener('DOMContentLoaded', () => {
  const registerForm = document.getElementById('register-form');
  const alertContainer = document.getElementById('alert-container');

  // Auto-dismiss alerts after 5 seconds
  if (alertContainer) {
    setTimeout(() => {
      alertContainer.style.opacity = '0';
      setTimeout(() => alertContainer.remove(), 300);
    }, 5000);
  }

  // Register validation
  if (registerForm) {
    registerForm.addEventListener('submit', (e) => {
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (password.length < 6) {
        e.preventDefault();
        showError('Password must be at least 6 characters long');
        return;
      }

      if (password !== confirmPassword) {
        e.preventDefault();
        showError('Passwords do not match');
      }
    });
  }

  function showError(msg) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4';
    errorDiv.role = 'alert';
    errorDiv.innerHTML = `<span class="block sm:inline">${msg}</span>`;

    const card = document.querySelector('.auth-card');
    if (card) {
      // Remove previous errors
      const oldErrors = card.querySelectorAll('[role="alert"]');
      oldErrors.forEach(err => err.remove());
      card.insertBefore(errorDiv, card.firstChild);
    }
  }
});
