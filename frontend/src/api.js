import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

export default api;

export function fmtIDR(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v);
}
export function fmtDate(s) {
  if (!s) return '-';
  return new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}
export function fmtDateOnly(s) {
  if (!s) return '-';
  return new Date(s).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}
export function statusPill(s) {
  return ({
    DRAFT: 'pill-draft',
    PENDING: 'pill-pending',
    APPROVED: 'pill-approved',
    REJECTED: 'pill-rejected',
  })[s] || 'pill-draft';
}
