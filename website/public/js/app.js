// Production Platform - Client-side JavaScript

document.addEventListener('DOMContentLoaded', function () {
  initToasts();
  initSocketIO();
  initDropdowns();
  initModals();
});

// Toast notifications
function initToasts() {
  if (!document.querySelector('.toast-container')) {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
}

function showToast(message, type = 'info', duration = 4000) {
  const container = document.querySelector('.toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Socket.IO
let socket = null;

function initSocketIO() {
  if (typeof io === 'undefined') return;

  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });

  socket.on('team-notification', (data) => {
    showToast(data.message, data.type || 'info');
  });

  socket.on('production-status-change', (data) => {
    showToast(`Production status changed to ${data.status}`, 'info');
  });
}

// Dropdowns
function initDropdowns() {
  document.addEventListener('click', (e) => {
    const dropdowns = document.querySelectorAll('[data-dropdown]');
    dropdowns.forEach(d => {
      if (!d.contains(e.target)) {
        d.querySelector('[data-dropdown-menu]')?.classList.add('hidden');
      }
    });
  });
}

function toggleDropdown(id) {
  const menu = document.querySelector(`#${id} [data-dropdown-menu]`);
  if (menu) {
    menu.classList.toggle('hidden');
  }
}

// Modals
function initModals() {
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function closeModal() {
  document.querySelectorAll('.modal-backdrop').forEach(m => {
    m.classList.add('hidden');
  });
}

// Utility: Time ago
function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = [
    { label: 'y', seconds: 31536000 },
    { label: 'mo', seconds: 2592000 },
    { label: 'd', seconds: 86400 },
    { label: 'h', seconds: 3600 },
    { label: 'm', seconds: 60 }
  ];
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) return `${count}${interval.label} ago`;
  }
  return 'just now';
}

// Fetch helper
async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// Confirm delete
function confirmDelete(message = 'Are you sure you want to delete this?') {
  return confirm(message);
}
