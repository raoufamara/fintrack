import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useAuthStore } from '@/stores/authStore'
import App from './App'
import './index.css'

// Initialize auth before rendering
useAuthStore.getState().initialize()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
