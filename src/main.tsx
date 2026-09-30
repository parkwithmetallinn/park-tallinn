import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminReviewView } from './components/AdminReviewView.tsx'

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const isAdmin =
  path === '/admin' ||
  path.endsWith('/admin') ||
  new URLSearchParams(window.location.search).has('admin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdmin ? <AdminReviewView /> : <App />}</StrictMode>,
)
